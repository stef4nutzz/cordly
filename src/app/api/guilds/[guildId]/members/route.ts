import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { connectToDatabase } from '@/lib/db';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { User } from '@/models/User';
import { UserSettings } from '@/models/UserSettings';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view community members.', 401);
  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id ownerId').exec();
  if (!guild) return jsonError('Community not found.', 404);
  const viewerMembership = await GuildMember.findOne({ guildId: guild._id, userId: user.objectId })
    .select('role')
    .exec();
  if (!viewerMembership) return jsonError('You are not a member of this community.', 403);

  const memberships = await GuildMember.find({ guildId: guild._id })
    .sort({ role: -1, createdAt: 1 })
    .select('userId role createdAt profile')
    .lean()
    .exec();
  const members = await User.find({
    _id: { $in: memberships.map((membership) => membership.userId) },
    deletedAt: null,
    disabledAt: null,
  }).select('id username tag status avatarVersion').exec();
  const byObjectId = new Map(members.map((member) => [member._id.toString(), member]));
  const settings = await UserSettings.find({ userId: { $in: memberships.map((membership) => membership.userId) } })
    .select('userId profile.displayName profile.pronouns profile.bio profile.timezone')
    .lean()
    .exec();
  const settingsByUserId = new Map(settings.map((setting) => [setting.userId.toString(), setting.profile]));
  return NextResponse.json({
    canManageMembers: viewerMembership.role === 'owner',
    members: memberships.flatMap((membership) => {
      const member = byObjectId.get(membership.userId.toString());
      const profile = settingsByUserId.get(membership.userId.toString());
      let timezoneOffset = 'UTC';
      if (profile?.timezone) {
        try {
          const timezoneName = new Intl.DateTimeFormat('en', {
            timeZone: profile.timezone,
            timeZoneName: 'shortOffset',
          }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
          if (timezoneName?.startsWith('GMT')) timezoneOffset = timezoneName === 'GMT' ? 'UTC' : timezoneName.replace(/^GMT/, 'UTC');
        } catch {
          timezoneOffset = 'UTC';
        }
      }
      return member ? [{
        id: member.id,
        username: member.username,
        displayName: membership.profile?.nickname || profile?.displayName || member.username,
        pronouns: profile?.pronouns ?? '',
        bio: membership.profile?.bio || profile?.bio || '',
        timezoneOffset,
        tag: member.tag,
        status: member.status,
        avatarUrl: publicAvatarUrl(member.id, member.avatarVersion),
        role: membership.role,
        owner: membership.role === 'owner',
        joinedAt: membership.createdAt.toISOString(),
      }] : [];
    }),
  });
}
