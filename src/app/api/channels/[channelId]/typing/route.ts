import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Channel } from '@/models/Channel';
import { ChannelTyping } from '@/models/ChannelTyping';
import { GuildMember } from '@/models/GuildMember';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ channelId: string }> };

async function authorized(request: NextRequest, channelId: string) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: jsonError('Sign in to view typing status.', 401) } as const;
  const channel = await Channel.findOne({ id: channelId, deletedAt: null }).select('_id guildId').exec();
  if (!channel) return { response: jsonError('Channel not found.', 404) } as const;
  if (!(await GuildMember.exists({ guildId: channel.guildId, userId: user.objectId }))) {
    return { response: jsonError('You are not a member of this community.', 403) } as const;
  }
  return { channel, user } as const;
}

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { channelId } = await context.params;
  const access = await authorized(request, channelId);
  if ('response' in access) return access.response;
  const active = await ChannelTyping.find({
    channelId: access.channel._id,
    userId: { $ne: access.user.objectId },
    expiresAt: { $gt: new Date() },
  }).select('userId').lean().exec();
  const users = await User.find({ _id: { $in: active.map((typing) => typing.userId) }, deletedAt: null })
    .select('username')
    .lean()
    .exec();
  return NextResponse.json({ users: users.map((user) => user.username) });
}

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { channelId } = await context.params;
  const access = await authorized(request, channelId);
  if ('response' in access) return access.response;
  await ChannelTyping.findOneAndUpdate(
    { channelId: access.channel._id, userId: access.user.objectId },
    { $set: { expiresAt: new Date(Date.now() + 6_000) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
  return NextResponse.json({ success: true });
}
