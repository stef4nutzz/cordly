import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Guild } from '@/models/Guild';
import { GuildInvite } from '@/models/GuildInvite';
import { GuildMember } from '@/models/GuildMember';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ guildId: string }> };
const schema = z.object({
  expiryHours: z.union([z.literal(24), z.literal(168), z.literal(0)]),
  maxUses: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(0)]),
});

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to invite members.', 401);
  const { guildId } = await context.params;
  const guild = await Guild.findOne({ id: guildId, deletedAt: null }).select('_id').exec();
  if (!guild) return jsonError('Community not found.', 404);
  const member = await GuildMember.findOne({ guildId: guild._id, userId: user.objectId }).select('role').exec();
  if (!member || member.role !== 'owner') return jsonError('Only the community owner can create invites.', 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Choose a valid invite expiry and use limit.', 400);
  const invite = await GuildInvite.create({
    code: randomBytes(12).toString('base64url'),
    guildId: guild._id,
    createdBy: user.objectId,
    expiresAt: parsed.data.expiryHours ? new Date(Date.now() + parsed.data.expiryHours * 3_600_000) : null,
    maxUses: parsed.data.maxUses || null,
  });
  return NextResponse.json({
    invite: {
      code: invite.code,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      maxUses: invite.maxUses,
      uses: invite.uses,
    },
  }, { status: 201 });
}
