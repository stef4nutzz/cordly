import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { jsonError, isDuplicateKeyError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { createGuild } from '@/server/services/guild-service';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view your communities.', 401);

  const memberships = await GuildMember.find({ userId: user.objectId }).select('guildId').lean().exec();
  const guilds = await Guild.find({
    _id: { $in: memberships.map((membership) => membership.guildId) },
    deletedAt: null,
  })
    .sort({ createdAt: 1 })
    .select('id name inviteCode detachedBanner')
    .lean()
    .exec();

  return NextResponse.json({
    guilds: guilds.map((guild) => ({
      id: guild.id,
      name: guild.name,
      inviteCode: guild.inviteCode,
      detachedBanner: guild.detachedBanner ?? false,
    })),
  });
}

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to create a community.', 401);

  try {
    const body: unknown = await request.json();
    if (typeof body !== 'object' || body === null || !('name' in body)) {
      return jsonError('A community name is required.', 400);
    }
    const { guild, channel } = await createGuild(user.objectId.toString(), body.name);
    return NextResponse.json(
      {
        guild: { id: guild.id, name: guild.name, inviteCode: guild.inviteCode, detachedBanner: guild.detachedBanner },
        channel: { id: channel.id, name: channel.name },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Community name must be 2–80 characters.', 400);
    if (isDuplicateKeyError(error)) {
      return jsonError('Community or default channel could not be created. Please retry.', 409);
    }
    return jsonError('Community could not be created.', 500);
  }
}
