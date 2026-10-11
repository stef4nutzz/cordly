import { NextRequest, NextResponse } from 'next/server';

import { connectToDatabase, isDatabaseConnected } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkRateLimit(`health:${address}`);

  if (!limit.allowed) {
    return NextResponse.json(
      { status: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let database = isDatabaseConnected();
  if (!database) {
    try {
      await connectToDatabase();
      database = isDatabaseConnected();
    } catch (error) {
      logger.warn({
        event: 'health_database_unavailable',
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      database = false;
    }
  }

  return NextResponse.json(
    {
      app: env.APP_NAME,
      status: database ? 'ok' : 'degraded',
      database: database ? 'connected' : 'unavailable',
    },
    { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
