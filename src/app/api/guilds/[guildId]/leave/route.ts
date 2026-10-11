import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { revokeRealtimeAccess } from '@/lib/realtime/instance';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ guildId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to leave a community.', 401);
  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id id ownerId').exec();
  if (!guild) return jsonError('Community not found.', 404);
  if (guild.ownerId.equals(user.objectId)) {
    return jsonError('The community owner must transfer ownership before leaving.', 409);
  }
  const membership = await GuildMember.deleteOne({ guildId: guild._id, userId: user.objectId }).exec();
  if (!membership.deletedCount) return jsonError('You are not a member of this community.', 403);
  revokeRealtimeAccess('guild', guild.id, [user.id]);
  return NextResponse.json({ success: true });
}
