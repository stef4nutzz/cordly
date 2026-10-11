import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Secret } from 'otpauth';
import QRCode from 'qrcode';
import { z } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  createTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  hashBackupCode,
} from '@/lib/totp';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
const setupSchema = z.object({ action: z.literal('setup'), currentPassword: z.string().min(1).max(128) }).strict();
const codeSchema = z.object({ action: z.enum(['enable', 'disable']), code: z.string().trim().min(6).max(16) }).strict();

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const sessionUser = await getAuthenticatedUser(request);
  if (!sessionUser) return jsonError('Sign in to manage two-factor authentication.', 401);
  const limit = checkRateLimit(`totp:${sessionUser.id}`, Date.now(), { maxRequests: 10, windowSeconds: 600 });
  if (!limit.allowed) return jsonError('Too many authentication changes. Try again later.', 429);
  const body: unknown = await request.json().catch(() => null);
  const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : null;
  const user = await User.findById(sessionUser.objectId)
    .select('+passwordHash +totpSecretEncrypted +backupCodeHashes')
    .exec();
  if (!user) return jsonError('Account not found.', 404);

  if (action === 'setup') {
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) return jsonError('Confirm your password before setting up an authenticator.', 400);
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return jsonError('The current password is incorrect.', 403);
    }
    if (user.totpEnabled) return jsonError('Two-factor authentication is already enabled.', 409);
    const secret = randomBytes(20).toString('hex').toUpperCase();
    const totp = createTotp(user.username, user.tag);
    totp.secret = Secret.fromHex(secret);
    user.totpSecretEncrypted = encryptTotpSecret(totp.secret.base32);
    await user.save();
    const uri = totp.toString();
    return NextResponse.json({ secret: totp.secret.base32, qrCode: await QRCode.toDataURL(uri) });
  }

  const parsed = codeSchema.safeParse(body);
  if (!parsed.success) return jsonError('Enter a valid authenticator code.', 400);
  if (!user.totpSecretEncrypted) return jsonError('Set up an authenticator before enabling it.', 409);
  const secret = decryptTotpSecret(user.totpSecretEncrypted);
  const totp = createTotp(user.username, user.tag, secret);
  if (totp.validate({ token: parsed.data.code.replace(/\s/g, ''), window: 1 }) === null) {
    return jsonError('That authenticator code is not valid.', 400);
  }

  if (parsed.data.action === 'enable') {
    if (user.totpEnabled) return jsonError('Two-factor authentication is already enabled.', 409);
    const backupCodes = generateBackupCodes();
    user.totpEnabled = true;
    user.backupCodeHashes = backupCodes.map(hashBackupCode);
    await user.save();
    return NextResponse.json({ enabled: true, backupCodes });
  }

  if (!user.totpEnabled) return jsonError('Two-factor authentication is not enabled.', 409);
  user.totpEnabled = false;
  user.totpSecretEncrypted = null;
  user.backupCodeHashes = [];
  await user.save();
  return NextResponse.json({ enabled: false });
}
