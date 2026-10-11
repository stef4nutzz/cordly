import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Channel } from '@/models/Channel';
import { Friendship } from '@/models/Friendship';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { Message } from '@/models/Message';
import { User } from '@/models/User';
import { UserSettings } from '@/models/UserSettings';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to export your account data.', 401);
  const [account, settings, friendships, memberships] = await Promise.all([
    User.findById(user.objectId).select('id username tag email status createdAt').lean().exec(),
    UserSettings.findOne({ userId: user.objectId }).select('-_id -userId').lean().exec(),
    Friendship.find({ $or: [{ requesterId: user.objectId }, { recipientId: user.objectId }] })
      .select('requesterId addresseeId status createdAt')
      .lean()
      .exec(),
    GuildMember.find({ userId: user.objectId }).select('guildId role createdAt').lean().exec(),
  ]);
  const guildIds = memberships.map((membership) => membership.guildId);
  const [guilds, channels] = await Promise.all([
    Guild.find({ _id: { $in: guildIds }, deletedAt: null }).select('id name createdAt').lean().exec(),
    Channel.find({ guildId: { $in: guildIds }, deletedAt: null }).select('id guildId name type createdAt').lean().exec(),
  ]);
  const channelIds = channels.map((channel) => channel._id);
  const messages = await Message.find({ authorId: user.objectId, channelId: { $in: channelIds } })
    .select('id channelId content createdAt editedAt deletedAt')
    .sort({ createdAt: 1 })
    .limit(100_000)
    .lean()
    .exec();
  const exportData = {
    exportedAt: new Date().toISOString(),
    account,
    settings,
    friendships,
    memberships,
    communities: guilds,
    channels,
    authoredMessages: messages,
  };
  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cordly-data-${user.id}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
