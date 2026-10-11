import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { publicBannerUrl } from '@/lib/banner';
import { connectToDatabase } from '@/lib/db';
import { env } from '@/lib/env';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
const contentTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function signatureIsValid(data: Buffer, type: string) {
  if (type === 'image/png') return data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (type === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === 'image/gif') return data.subarray(0, 3).toString('ascii') === 'GIF';
  return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
}

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to update your profile banner.', 401);
  const form = await request.formData().catch(() => null);
  const file = form?.get('banner');
  if (!(file instanceof File)) return jsonError('Choose an image for your banner.', 400);
  if (!contentTypes.has(file.type)) return jsonError('Banner must be a PNG, JPEG, GIF, or WebP image.', 415);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 1 || bytes.length > env.MAX_UPLOAD_MB * 1024 * 1024) {
    return jsonError(`Banner must be smaller than ${env.MAX_UPLOAD_MB} MB.`, 413);
  }
  if (!signatureIsValid(bytes, file.type)) return jsonError('The banner file does not match its declared image type.', 415);
  const version = randomUUID();
  await User.updateOne(
    { _id: user.objectId, deletedAt: null, disabledAt: null },
    { $set: { bannerData: bytes, bannerContentType: file.type, bannerVersion: version } },
  ).exec();
  return NextResponse.json({ bannerUrl: publicBannerUrl(user.id, version) });
}

export async function DELETE(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to remove your profile banner.', 401);
  await User.updateOne(
    { _id: user.objectId, deletedAt: null },
    { $unset: { bannerData: 1, bannerContentType: 1 }, $set: { bannerVersion: null } },
  ).exec();
  return NextResponse.json({ bannerUrl: null });
}
