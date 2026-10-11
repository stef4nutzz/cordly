import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { emitRealtime } from '@/lib/realtime/instance';
import { Session } from '@/models/Session';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ sessionId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to revoke sessions.', 401);
  const { sessionId } = await context.params;
  const session = await Session.findOneAndUpdate(
    { id: sessionId, userId: user.objectId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true },
  ).exec();
  if (!session) return jsonError('That active session could not be found.', 404);
  emitRealtime(`session:${session.id}`, 'session:revoked', null);
  return NextResponse.json({ success: true });
}
