import { NextResponse } from 'next/server';

import { connectToDatabase } from '@/lib/db';
import { User } from '@/models/User';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  await connectToDatabase();
  const { userId } = await params;
  const user = await User.findOne({ id: userId, deletedAt: null, disabledAt: null })
    .select('+avatarData +avatarContentType')
    .exec();
  if (!user?.avatarData || !user.avatarContentType) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(user.avatarData), {
    headers: {
      'Content-Type': user.avatarContentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
