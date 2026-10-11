import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Channel } from '@/models/Channel';
import { joinGuild } from '@/server/services/guild-service';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to join a server.', 401);

  try {
    const body: unknown = await request.json();
    const inviteCode =
      typeof body === 'object' && body !== null && 'inviteCode' in body
        ? body.inviteCode
        : undefined;
    const guild = await joinGuild(user.objectId.toString(), inviteCode);
    if (!guild) return jsonError('No server matches that invite code.', 404);

    const channel = await Channel.findOne({ guildId: guild._id, deletedAt: null })
      .sort({ createdAt: 1 })
      .select('id name')
      .exec();
    return NextResponse.json({
      guild: { id: guild.id, name: guild.name, inviteCode: guild.inviteCode },
      channel: channel ? { id: channel.id, name: channel.name } : null,
    });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Enter a valid server invite code.', 400);
    return jsonError('Could not join this community.', 500);
  }
}
