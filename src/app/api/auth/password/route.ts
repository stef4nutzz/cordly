import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { env } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { Session } from '@/models/Session';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
const schema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
}).strict();

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const sessionUser = await getAuthenticatedUser(request);
  if (!sessionUser) return jsonError('Sign in to change your password.', 401);
  const limit = checkRateLimit(`password-change:${sessionUser.id}`, Date.now(), { maxRequests: 5, windowSeconds: 3_600 });
  if (!limit.allowed) return jsonError(`Try again in ${limit.retryAfterSeconds} seconds.`, 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError('Enter your current password and a new password of at least 8 characters.', 400);
  const user = await User.findById(sessionUser.objectId).select('passwordHash').exec();
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return jsonError('The current password is incorrect.', 403);
  }
  user.passwordHash = await bcrypt.hash(parsed.data.newPassword, env.BCRYPT_ROUNDS);
  await user.save();
  return NextResponse.json({ success: true });
}
