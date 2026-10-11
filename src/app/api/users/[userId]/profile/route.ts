import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { publicBannerUrl } from '@/lib/banner';
import { connectToDatabase } from '@/lib/db';
import { Friendship } from '@/models/Friendship';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { User } from '@/models/User';
import { UserSettings } from '@/models/UserSettings';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ userId: string }> };
type ProfileSettings = {
  profile?: { displayName?: string; pronouns?: string; bio?: string; timezone?: string };
  preferences?: { privacy?: { showActivity?: boolean } };
};
type ProfileMembership = {
  guildId: Types.ObjectId;
  role: 'owner' | 'member';
  createdAt: Date;
  profile?: { nickname?: string };
  preferences?: { showActivity?: boolean };
};
type ViewerMembership = { guildId: Types.ObjectId };
type CommunitySummary = { _id: Types.ObjectId; id: string; name: string };

function utcOffset(timezone?: string) {
  if (!timezone) return 'UTC';
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
    return name?.startsWith('GMT') ? (name === 'GMT' ? 'UTC' : name.replace(/^GMT/, 'UTC')) : 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const viewer = await getAuthenticatedUser(request);
  if (!viewer) return jsonError('Sign in to view profiles.', 401);
  const { userId } = await context.params;
  const target = await User.findOne({ id: userId, deletedAt: null, disabledAt: null })
    .select('id username tag status platformRole avatarVersion bannerVersion createdAt')
    .exec();
  if (!target) return jsonError('That profile could not be found.', 404);

  const [targetSettings, targetMemberships, viewerMemberships, friendship] = await Promise.all([
    UserSettings.findOne({ userId: target._id })
      .select('profile preferences.privacy.showActivity').lean<ProfileSettings>().exec(),
    GuildMember.find({ userId: target._id })
      .select('guildId role createdAt profile preferences.showActivity').lean<ProfileMembership[]>().exec(),
    GuildMember.find({ userId: viewer.objectId }).select('guildId').lean<ViewerMembership[]>().exec(),
    Friendship.findOne({
      $or: [
        { requesterId: viewer.objectId, recipientId: target._id },
        { requesterId: target._id, recipientId: viewer.objectId },
      ],
    }).select('status requesterId').exec(),
  ]);

  const commonGuildIds = viewerMemberships
    .map((membership) => membership.guildId.toString())
    .filter((guildId) => targetMemberships.some((membership) => membership.guildId.toString() === guildId));
  const mutualCommunities = commonGuildIds.length
    ? await Guild.find({ _id: { $in: commonGuildIds }, deletedAt: null })
        .select('id name').lean<CommunitySummary[]>().exec()
    : [];
  const communityId = request.nextUrl.searchParams.get('communityId');
  const currentMembership = communityId && commonGuildIds.length
    ? targetMemberships.find((membership) =>
        commonGuildIds.includes(membership.guildId.toString()) &&
        mutualCommunities.some((community) => community.id === communityId && community._id.toString() === membership.guildId.toString()))
    : undefined;

  const accepted = friendship?.status === 'accepted';
  const mutualFriendships = await Friendship.find({
    status: 'accepted',
    $or: [{ requesterId: target._id }, { recipientId: target._id }],
  }).select('requesterId recipientId').lean().exec();
  const targetFriendIds = mutualFriendships.map((relation) =>
    relation.requesterId.toString() === target._id.toString() ? relation.recipientId : relation.requesterId);
  const viewerFriendships = targetFriendIds.length
    ? await Friendship.find({
        status: 'accepted',
        $or: [
          { requesterId: viewer.objectId, recipientId: { $in: targetFriendIds } },
          { recipientId: viewer.objectId, requesterId: { $in: targetFriendIds } },
        ],
      }).select('requesterId recipientId').lean().exec()
    : [];
  const mutualFriendIds = viewerFriendships.map((relation) =>
    relation.requesterId.toString() === viewer.objectId.toString() ? relation.recipientId : relation.requesterId);
  const mutualFriends = mutualFriendIds.length
    ? await User.find({ _id: { $in: mutualFriendIds }, deletedAt: null, disabledAt: null })
        .select('id username tag status avatarVersion').lean().exec()
    : [];

  const hiddenActivity = targetSettings?.preferences?.privacy?.showActivity === false ||
    (currentMembership ? currentMembership.preferences?.showActivity === false : false);
  return NextResponse.json({
    profile: {
      id: target.id,
      username: target.username,
      displayName: currentMembership?.profile?.nickname || targetSettings?.profile?.displayName || target.username,
      tag: target.tag,
      pronouns: targetSettings?.profile?.pronouns ?? '',
      bio: targetSettings?.profile?.bio ?? '',
      timezoneOffset: utcOffset(targetSettings?.profile?.timezone),
      status: hiddenActivity ? 'offline' : target.status,
      platformRole: target.platformRole,
      avatarUrl: publicAvatarUrl(target.id, target.avatarVersion),
      bannerUrl: publicBannerUrl(target.id, target.bannerVersion),
      accountCreatedAt: target.createdAt.toISOString(),
      isFriend: accepted,
      friendRequestPending: friendship?.status === 'pending',
      canAcceptFriendRequest: friendship?.status === 'pending' && friendship.requesterId.equals(target._id),
      community: currentMembership ? {
        name: mutualCommunities.find((community) => community._id.toString() === currentMembership.guildId.toString())?.name ?? '',
        role: currentMembership.role,
        joinedAt: currentMembership.createdAt.toISOString(),
      } : null,
      mutualCommunities: mutualCommunities.map((community) => ({ id: community.id, name: community.name })),
      mutualFriends: mutualFriends.map((friend) => ({
        id: friend.id,
        username: friend.username,
        tag: friend.tag,
        avatarUrl: publicAvatarUrl(friend.id, friend.avatarVersion),
      })),
    },
  });
}
