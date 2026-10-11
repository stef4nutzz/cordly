import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ guildId: string }> };

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  detachedBanner: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0);

export async function PATCH(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to update community settings.', 401);
  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).exec();
  if (!guild) return jsonError('Community not found.', 404);
  const member = await GuildMember.findOne({ guildId: guild._id, userId: user.objectId }).select('role').exec();
  if (!member || member.role !== 'owner') return jsonError('Only the community owner can change these settings.', 403);

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('The community settings are invalid.', 400);
  if (parsed.data.name !== undefined) guild.name = parsed.data.name;
  if (parsed.data.detachedBanner !== undefined) guild.detachedBanner = parsed.data.detachedBanner;
  await guild.save();
  return NextResponse.json({
    community: { id: guild.id, name: guild.name, detachedBanner: guild.detachedBanner },
  });
}
