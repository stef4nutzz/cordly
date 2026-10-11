import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { isDuplicateKeyError, jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Guild } from '@/models/Guild';
import { GuildCategory } from '@/models/GuildCategory';
import { GuildMember } from '@/models/GuildMember';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ guildId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view categories.', 401);
  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id').exec();
  if (!guild) return jsonError('Community not found.', 404);
  if (!(await GuildMember.exists({ guildId: guild._id, userId: user.objectId }))) {
    return jsonError('You are not a member of this community.', 403);
  }
  const categories = await GuildCategory.find({ guildId: guild._id }).sort({ createdAt: 1 }).select('id name').lean().exec();
  return NextResponse.json({
    categories: categories.map((category) => ({ id: category.id, name: category.name })),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to create categories.', 401);
  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id').exec();
  if (!guild) return jsonError('Community not found.', 404);
  const member = await GuildMember.findOne({ guildId: guild._id, userId: user.objectId }).select('role').exec();
  if (!member || member.role !== 'owner') return jsonError('Only the community owner can create categories.', 403);
  try {
    const body = z.object({ name: z.string().trim().min(1).max(64) }).strict().parse(await request.json());
    const category = await GuildCategory.create({ guildId: guild._id, name: body.name });
    return NextResponse.json({ category: { id: category.id, name: category.name } }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Category names must be between 1 and 64 characters.', 400);
    if (isDuplicateKeyError(error)) return jsonError('A category with that name already exists.', 409);
    return jsonError('Category could not be created.', 500);
  }
}
