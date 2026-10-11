import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Session } from '@/models/Session';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const sessionUser = await getAuthenticatedUser(request);
  if (!sessionUser) return jsonError('Sign in to disable your account.', 401);
  const body: unknown = await request.json().catch(() => null);
  const password = typeof body === 'object' && body !== null && 'password' in body && typeof body.password === 'string'
    ? body.password
    : '';
  if (!password) return jsonError('Enter your password to confirm account deactivation.', 400);
  const user = await User.findById(sessionUser.objectId).select('passwordHash').exec();
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return jsonError('The password is incorrect.', 403);
  await Promise.all([
    User.updateOne({ _id: sessionUser.objectId, disabledAt: null }, { $set: { disabledAt: new Date(), status: 'offline' } }).exec(),
    Session.updateMany({ userId: sessionUser.objectId, revokedAt: null }, { $set: { revokedAt: new Date() } }).exec(),
  ]);
  return NextResponse.json({ success: true });
}
