import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { UserSettings } from '@/models/UserSettings';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  pronouns: z.string().trim().max(40).optional(),
  bio: z.string().trim().max(190).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  accentColor: color.optional(),
  primaryColor: color.optional(),
  secondaryColor: color.optional(),
}).strict();

const preferencesSchema = z.object({
  appearance: z.object({
    theme: z.enum(['oled', 'dark', 'light', 'system']).optional(),
    messageLayout: z.enum(['cozy', 'compact']).optional(),
    fontSize: z.number().int().min(12).max(20).optional(),
    groupSpacing: z.number().int().min(0).max(32).optional(),
    zoom: z.number().int().min(80).max(120).optional(),
    roleColors: z.boolean().optional(),
    saturation: z.number().int().min(0).max(100).optional(),
  }).strict().optional(),
  notifications: z.object({
    desktopPush: z.boolean().optional(),
    sounds: z.boolean().optional(),
    soundVolume: z.number().int().min(0).max(100).optional(),
    unreadBadges: z.boolean().optional(),
    quietHours: z.boolean().optional(),
  }).strict().optional(),
  privacy: z.object({
    directMessages: z.enum(['everyone', 'friends', 'nobody']).optional(),
    friendRequests: z.enum(['everyone', 'mutuals', 'nobody']).optional(),
    explicitMediaFilter: z.boolean().optional(),
    showActivity: z.boolean().optional(),
    readReceipts: z.boolean().optional(),
  }).strict().optional(),
  chat: z.object({
    linkPreviews: z.boolean().optional(),
    inlineAttachments: z.boolean().optional(),
    convertEmoticons: z.boolean().optional(),
    hideSpoilers: z.boolean().optional(),
    gifAutoplay: z.boolean().optional(),
    sendOnEnter: z.boolean().optional(),
    clockFormat: z.enum(['12h', '24h']).optional(),
  }).strict().optional(),
  accessibility: z.object({
    reducedMotion: z.boolean().optional(),
    highContrast: z.boolean().optional(),
    underlineLinks: z.boolean().optional(),
    keyboardFocus: z.boolean().optional(),
    animatedEmoji: z.boolean().optional(),
  }).strict().optional(),
  language: z.string().trim().min(2).max(16).optional(),
  developerMode: z.boolean().optional(),
}).strict();

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view your settings.', 401);
  const settings = await UserSettings.findOneAndUpdate(
    { userId: user.objectId },
    { $setOnInsert: { userId: user.objectId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
  if (!settings) return jsonError('Settings could not be loaded.', 500);
  return NextResponse.json({ profile: settings.profile, preferences: settings.preferences });
}

export async function PATCH(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to update your settings.', 401);
  const parsed = z.object({
    profile: profileSchema.optional(),
    preferences: preferencesSchema.optional(),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.profile && !parsed.data.preferences)) {
    return jsonError('The settings update is invalid.', 400);
  }

  const updates: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parsed.data.profile ?? {})) {
    if (key === 'timezone' && value) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
      } catch {
        return jsonError('Choose a valid time zone.', 400);
      }
    }
    updates[`profile.${key}`] = value;
  }
  for (const [section, values] of Object.entries(parsed.data.preferences ?? {})) {
    if (values && typeof values === 'object') {
      for (const [key, value] of Object.entries(values)) {
        updates[`preferences.${section}.${key}`] = value as string | number | boolean;
      }
    } else if (values !== undefined) {
      updates[`preferences.${section}`] = values as string | number | boolean;
    }
  }

  const settings = await UserSettings.findOneAndUpdate(
    { userId: user.objectId },
    { $set: updates, $setOnInsert: { userId: user.objectId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  ).exec();
  if (!settings) return jsonError('Settings could not be saved.', 500);
  return NextResponse.json({ profile: settings.profile, preferences: settings.preferences });
}
