import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { connectToDatabase } from '@/lib/db';
import { jsonError } from '@/lib/api';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { registerUser } from '@/server/services/register-user';
import { createSession } from '@/server/services/session-service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkRateLimit(`register:${address}`);
  if (!limit.allowed) {
    return jsonError('Too many registration attempts. Try again later.', 429);
  }

  try {
    const body: unknown = await request.json();
    await connectToDatabase();
    const registered = await registerUser(body);
    const { internalId, ...user } = registered;
    const response = NextResponse.json({ user }, { status: 201 });
    await createSession(internalId, request, response);
    return response;
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Check the submitted registration details.', fields: error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    ) {
      return jsonError('An account with that email or username tag already exists.', 409);
    }
    const errorType = error instanceof Error ? error.name : 'UnknownError';
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : undefined;
    const validationPaths =
      errorType === 'ValidationError' &&
      typeof error === 'object' &&
      error !== null &&
      'errors' in error &&
      typeof error.errors === 'object' &&
      error.errors !== null
        ? Object.keys(error.errors)
        : undefined;
    logger.error({
      event: 'registration_failed',
      errorType,
      errorCode,
      validationPaths,
    });
    return jsonError('Registration could not be completed. Please try again.', 500);
  }
}
