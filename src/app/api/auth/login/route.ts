import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { connectToDatabase } from '@/lib/db';
import { jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { checkRateLimit } from '@/lib/rate-limit';
import { decryptTotpSecret, hashBackupCode, createTotp } from '@/lib/totp';
import { User } from '@/models/User';
import { createSession } from '@/server/services/session-service';

export const runtime = 'nodejs';

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(287),
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(16).optional(),
});

export async function POST(request: NextRequest) {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkRateLimit(`login:${address}`);
  if (!limit.allowed) return jsonError('Too many login attempts. Try again later.', 429);

  try {
    const input = loginSchema.parse(await request.json());
    await connectToDatabase();
    const identifier = input.identifier.toLowerCase();
    const tagMatch = identifier.match(/^(.+)#(\d{4})$/);
    const user = await User.findOne({
      deletedAt: null,
      disabledAt: null,
      ...(tagMatch
        ? { usernameLower: tagMatch[1], tag: tagMatch[2] }
        : { email: identifier }),
    })
      .select('+passwordHash +totpSecretEncrypted +backupCodeHashes')
      .exec();

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return jsonError('Email or password is incorrect.', 401);
    }

    if (user.totpEnabled) {
      if (!input.code) return jsonError('Enter your authenticator code to continue.', 401);
      const normalizedCode = input.code.replace(/\s/g, '');
      const validTotp = user.totpSecretEncrypted
        ? createTotp(user.username, user.tag, decryptTotpSecret(user.totpSecretEncrypted))
            .validate({ token: normalizedCode, window: 1 }) !== null
        : false;
      if (!validTotp) {
        const hashedCode = hashBackupCode(normalizedCode);
        const codeIndex = user.backupCodeHashes.indexOf(hashedCode);
        if (codeIndex < 0) return jsonError('The authenticator code is incorrect.', 401);
        user.backupCodeHashes.splice(codeIndex, 1);
      }
    }

    user.lastLoginAt = new Date();
    user.status = 'online';
    await user.save();
    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        tag: user.tag,
        status: user.status,
        platformRole: user.platformRole,
        avatarUrl: publicAvatarUrl(user.id, user.avatarVersion),
      },
    });
    await createSession(user._id.toString(), request, response);
    return response;
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Enter your account and password.', 400);
    return jsonError('Login could not be completed. Please try again.', 500);
  }
}
