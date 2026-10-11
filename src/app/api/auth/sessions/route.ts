import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { Session } from '@/models/Session';
import { getAuthenticatedUser, SESSION_COOKIE } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view active sessions.', 401);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const currentHash = token ? createHash('sha256').update(token).digest('hex') : '';
  const sessions = await Session.find({ userId: user.objectId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .select('id userAgent ip createdAt lastUsedAt expiresAt tokenHash')
    .exec();
  return NextResponse.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
      current: session.tokenHash === currentHash,
    })),
  });
}
