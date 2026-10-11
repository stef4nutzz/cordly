import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

import { env } from '@/lib/env';

const key = createHash('sha256').update(env.AUTH_SECRET).digest();

export function createTotp(username: string, tag: string, secret?: string) {
  return new TOTP({
    issuer: env.APP_NAME,
    label: `${username}#${tag}`,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    ...(secret ? { secret: Secret.fromBase32(secret) } : {}),
  });
}

export function encryptTotpSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.');
}

export function decryptTotpSecret(value: string) {
  const [ivHex, tagHex, encryptedHex] = value.split('.');
  if (!ivHex || !tagHex || !encryptedHex) throw new Error('Stored authentication secret is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

export function hashBackupCode(code: string) {
  return createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
}

export function generateBackupCodes() {
  return Array.from({ length: 10 }, () => {
    const value = randomBytes(5).toString('hex').toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}
