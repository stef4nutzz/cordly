import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Guild } from '@/models/Guild';
import { GuildMember, type GuildMemberDocument } from '@/models/GuildMember';
import { Channel } from '@/models/Channel';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ guildId: string }> };

const schema = z.object({
  notificationLevel: z.enum(['all', 'mentions', 'nothing']).optional(),
  suppressEveryone: z.boolean().optional(),
  suppressRoles: z.boolean().optional(),
  muteHours: z.union([z.literal(0), z.literal(1), z.literal(8), z.literal(24), z.literal(168)]).optional(),
  allowMemberDms: z.boolean().optional(),
  showActivity: z.boolean().optional(),
  hideMutedChannels: z.boolean().optional(),
  favoriteChannelIds: z.array(z.string().min(1).max(64)).max(200).optional(),
  nickname: z.string().trim().max(32).optional(),
  bio: z.string().trim().max(190).optional(),
}).strict();

async function getMembership(request: NextRequest, guildId: string) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: jsonError('Sign in to update community preferences.', 401) } as const;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id').exec();
  if (!guild) return { response: jsonError('Community not found.', 404) } as const;
  const member = await GuildMember.findOne({ guildId: guild._id, userId: user.objectId }).exec();
  if (!member) return { response: jsonError('You are not a member of this community.', 403) } as const;
  return { member } as const;
}

function getMemberSettings(member: GuildMemberDocument) {
  return {
    preferences: {
      notificationLevel: member.preferences?.notificationLevel ?? 'all',
      suppressEveryone: member.preferences?.suppressEveryone ?? false,
      suppressRoles: member.preferences?.suppressRoles ?? false,
      muteUntil: member.preferences?.muteUntil ?? null,
      allowMemberDms: member.preferences?.allowMemberDms ?? true,
      showActivity: member.preferences?.showActivity ?? true,
      hideMutedChannels: member.preferences?.hideMutedChannels ?? false,
      favoriteChannelIds: member.preferences?.favoriteChannelIds ?? [],
    },
    profile: {
      nickname: member.profile?.nickname ?? '',
      bio: member.profile?.bio ?? '',
    },
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { guildId } = await context.params;
  const access = await getMembership(request, guildId);
  if ('response' in access) return access.response;
  return NextResponse.json(getMemberSettings(access.member));
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { guildId } = await context.params;
  const access = await getMembership(request, guildId);
  if ('response' in access) return access.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return jsonError('The community preference update is invalid.', 400);
  }
  const { muteHours, nickname, bio, ...preferenceUpdates } = parsed.data;
  const favorites = preferenceUpdates.favoriteChannelIds;
  if (favorites) {
    const channels = await Channel.find({
      guildId: access.member.guildId,
      id: { $in: favorites },
      deletedAt: null,
    }).select('id').lean().exec();
    if (channels.length !== new Set(favorites).size) {
      return jsonError('Favorites must be channels in this community.', 400);
    }
  }
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(preferenceUpdates)) {
    set[`preferences.${key}`] = value;
  }
  if (muteHours !== undefined) {
    set['preferences.muteUntil'] = muteHours ? new Date(Date.now() + muteHours * 3_600_000) : null;
  }
  if (nickname !== undefined) set['profile.nickname'] = nickname;
  if (bio !== undefined) set['profile.bio'] = bio;
  for (const [path, value] of Object.entries(set)) access.member.set(path, value);
  await access.member.save();
  return NextResponse.json(getMemberSettings(access.member));
}
