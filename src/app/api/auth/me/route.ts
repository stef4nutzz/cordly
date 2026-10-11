import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { connectToDatabase } from '@/lib/db';
import { publishPresence } from '@/server/services/realtime-presence';
import { isDuplicateKeyError, jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { publicBannerUrl } from '@/lib/banner';
import { getAuthenticatedUser } from '@/server/services/session-service';
import { User } from '@/models/User';
import { UsernameChange } from '@/models/UsernameChange';

export const runtime = 'nodejs';

const accountSettingsSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-zA-Z0-9_.-]+$/)
      .optional(),
    status: z.enum(['online', 'idle', 'dnd', 'offline']).optional(),
    tag: z.string().regex(/^\d{4}$/).optional(),
  })
  .refine((settings) => settings.username !== undefined || settings.status !== undefined || settings.tag !== undefined);

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  const details = user ? await User.findById(user.objectId).select('email createdAt totpEnabled').exec() : null;
  return NextResponse.json({
    user: user
      ? {
          id: user.id,
          username: user.username,
          tag: user.tag,
          status: user.status,
          platformRole: user.platformRole,
          avatarUrl: user.avatarUrl,
          bannerUrl: user.bannerUrl,
          email: details?.email ?? '',
          createdAt: details?.createdAt.toISOString() ?? null,
          twoFactorEnabled: details?.totpEnabled ?? false,
        }
      : null,
  });
}

export async function PATCH(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to update your account.', 401);

  try {
    const settings = accountSettingsSchema.parse(await request.json());
    const usernameChanged =
      (settings.username !== undefined && settings.username !== user.username) ||
      (settings.tag !== undefined && settings.tag !== user.tag);
    if (usernameChanged) {
      const [lastHour, lastDay] = await Promise.all([
        UsernameChange.countDocuments({ userId: user.objectId, createdAt: { $gte: new Date(Date.now() - 3_600_000) } }),
        UsernameChange.countDocuments({ userId: user.objectId, createdAt: { $gte: new Date(Date.now() - 86_400_000) } }),
      ]);
      if (lastHour >= 2 || lastDay >= 10) {
        return jsonError('Username changes are limited to 2 per hour and 10 per day.', 429);
      }
    }
    const updates = {
      ...(settings.username !== undefined
        ? { username: settings.username, usernameLower: settings.username.toLowerCase() }
        : {}),
      ...(settings.status !== undefined ? { status: settings.status } : {}),
      ...(settings.tag !== undefined ? { tag: settings.tag } : {}),
    };
    const updatedUser = await User.findOneAndUpdate(
      { _id: user.objectId, deletedAt: null, disabledAt: null },
      { $set: updates },
      { new: true, runValidators: true },
    )
      .select('id username tag status platformRole avatarVersion bannerVersion')
      .exec();

    if (!updatedUser) return jsonError('Account could not be found.', 404);
    if (usernameChanged) await UsernameChange.create({ userId: user.objectId });
    if (settings.status !== undefined) {
      await publishPresence(user.objectId.toString(), settings.status !== 'offline', settings.status);
    }
    return NextResponse.json({
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        tag: updatedUser.tag,
        status: updatedUser.status,
        platformRole: updatedUser.platformRole,
        avatarUrl: publicAvatarUrl(updatedUser.id, updatedUser.avatarVersion),
        bannerUrl: publicBannerUrl(updatedUser.id, updatedUser.bannerVersion),
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Check the username and status.', fields: error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    if (isDuplicateKeyError(error)) {
      return jsonError('That username and tag are already in use.', 409);
    }
    return jsonError('Account settings could not be saved.', 500);
  }
}
