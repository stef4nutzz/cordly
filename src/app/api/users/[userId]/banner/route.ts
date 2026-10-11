import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { User } from '@/models/User';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { userId } = await context.params;
  const user = await User.findOne({ id: userId, deletedAt: null, disabledAt: null })
    .select('+bannerData +bannerContentType bannerVersion')
    .exec();
  if (!user?.bannerData || !user.bannerContentType) return jsonError('Banner not found.', 404);
  if (user.bannerVersion !== _request.nextUrl.searchParams.get('v')) return jsonError('Banner not found.', 404);
  return new NextResponse(new Uint8Array(user.bannerData), {
    headers: {
      'Content-Type': user.bannerContentType,
      'Content-Length': String(user.bannerData.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
