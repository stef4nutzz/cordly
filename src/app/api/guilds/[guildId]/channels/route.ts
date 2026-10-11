import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { jsonError, isDuplicateKeyError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Channel } from '@/models/Channel';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { GuildCategory } from '@/models/GuildCategory';
import { createGuildChannel } from '@/server/services/guild-service';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view channels.', 401);

  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id').exec();
  if (!guild) return jsonError('Community not found.', 404);

  const membership = await GuildMember.exists({ guildId: guild._id, userId: user.objectId });
  if (!membership) return jsonError('You are not a member of this community.', 403);

  const channels = await Channel.collection
    .find(
      { guildId: guild._id, deletedAt: null },
      { projection: { id: 1, name: 1, type: 1, categoryId: 1 } },
    )
    .sort({ createdAt: 1 })
    .toArray();
  const categoryIds = channels.flatMap((channel) => channel.categoryId ? [channel.categoryId] : []);
  const categories = categoryIds.length
    ? await GuildCategory.find({ _id: { $in: categoryIds } }).select('_id id').lean().exec()
    : [];
  const categoryPublicIds = new Map(categories.map((category) => [String(category._id), category.id]));
  return NextResponse.json({
    channels: channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      categoryId: channel.categoryId ? categoryPublicIds.get(channel.categoryId.toString()) ?? null : null,
    })),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to create a channel.', 401);

  const { guildId } = await context.params;
  try {
    const body: unknown = await request.json();
    const name = typeof body === 'object' && body !== null && 'name' in body ? body.name : undefined;
    const categoryId = typeof body === 'object' && body !== null && 'categoryId' in body ? body.categoryId : undefined;
    const channel = await createGuildChannel(user.objectId.toString(), guildId, name, categoryId);
    if (!channel) return jsonError('Only this community’s owner can create channels.', 403);
    const publicCategoryId = typeof categoryId === 'string' ? categoryId : null;
    return NextResponse.json(
      { channel: { id: channel.id, name: channel.name, type: channel.type, categoryId: publicCategoryId } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError('Channel names must use letters, numbers, and hyphens.', 400);
    }
    if (isDuplicateKeyError(error)) return jsonError('That channel already exists.', 409);
    return jsonError('Channel could not be created.', 500);
  }
}
