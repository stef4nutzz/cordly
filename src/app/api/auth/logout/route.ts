import { NextRequest, NextResponse } from 'next/server';

import { connectToDatabase } from '@/lib/db';
import { env } from '@/lib/env';
import { SESSION_COOKIE, revokeSession } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  await connectToDatabase();
  await revokeSession(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(0),
  });
  return response;
}
