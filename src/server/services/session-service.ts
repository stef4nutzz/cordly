import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { publicAvatarUrl } from '@/lib/avatar';
import { publicBannerUrl } from '@/lib/banner';
import { emitRealtime } from '@/lib/realtime/instance';
import { Session } from '@/models/Session';
import { User } from '@/models/User';

export const SESSION_COOKIE = 'cordly_session';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  request: NextRequest,
  response: NextResponse,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;

  await Session.create({
    userId,
    tokenHash: hashToken(token),
    userAgent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
    ip,
    expiresAt,
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getAuthenticatedUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  return authenticateSessionToken(token);
}

export async function authenticateSessionToken(token: string) {
  const session = await Session.findOne({
    tokenHash: hashToken(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .select('id userId')
    .exec();
  if (!session) return null;

  const user = await User.findOne({
    _id: session.userId,
    deletedAt: null,
    disabledAt: null,
  })
    .select('id username tag status platformRole avatarVersion bannerVersion')
    .exec();

  if (!user) return null;

  await Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } }).exec();
  return {
    objectId: user._id,
    sessionId: session.id,
    id: user.id,
    username: user.username,
    tag: user.tag,
    status: user.status,
    platformRole: user.platformRole,
    avatarUrl: publicAvatarUrl(user.id, user.avatarVersion),
    bannerUrl: publicBannerUrl(user.id, user.bannerVersion),
  };
}

export async function revokeSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const session = await Session.findOneAndUpdate(
    { tokenHash: hashToken(token), revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true },
  ).select('id').exec();
  if (session) emitRealtime(`session:${session.id}`, 'session:revoked', null);
}
