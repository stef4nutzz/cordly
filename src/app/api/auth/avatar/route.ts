import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { logger } from '@/lib/logger';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function detectImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to update your profile picture.', 401);

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_AVATAR_BYTES + 64 * 1024) {
    return jsonError('Profile pictures must be 5 MB or smaller.', 413);
  }

  try {
    const form = await request.formData();
    const file = form.get('avatar');
    if (!(file instanceof File)) return jsonError('Choose an image to upload.', 400);
    if (file.size === 0 || file.size > MAX_AVATAR_BYTES) {
      return jsonError('Profile pictures must be between 1 byte and 5 MB.', 413);
    }

    const avatarData = Buffer.from(await file.arrayBuffer());
    const contentType = detectImageType(avatarData);
    if (!contentType || contentType !== file.type) {
      return jsonError('Upload a valid PNG, JPEG, GIF, or WebP image.', 415);
    }

    const avatarVersion = randomUUID();
    const updated = await User.updateOne(
      { _id: user.objectId, deletedAt: null, disabledAt: null },
      { $set: { avatarData, avatarContentType: contentType, avatarVersion } },
    ).exec();
    if (updated.matchedCount === 0) return jsonError('Account could not be found.', 404);

    return NextResponse.json({
      avatarUrl: `/api/users/${encodeURIComponent(user.id)}/avatar?v=${avatarVersion}`,
    });
  } catch (error) {
    logger.error({
      event: 'avatar_upload_failed',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return jsonError('Profile picture could not be saved.', 500);
  }
}

export async function DELETE(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to update your profile picture.', 401);

  try {
    await User.updateOne(
      { _id: user.objectId, deletedAt: null, disabledAt: null },
      { $unset: { avatarData: 1, avatarContentType: 1, avatarVersion: 1 } },
    ).exec();
    return NextResponse.json({ avatarUrl: null });
  } catch (error) {
    logger.error({
      event: 'avatar_remove_failed',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return jsonError('Profile picture could not be removed.', 500);
  }
}
