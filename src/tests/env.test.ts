import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseEnv } from '../lib/env-schema';

const validEnv = {
  MONGO_URL: 'mongodb://127.0.0.1:27017/cordly',
  AUTH_SECRET: randomBytes(48).toString('base64'),
};

describe('environment validation', () => {
  it('parses valid configuration and applies defaults', () => {
    const parsed = parseEnv(validEnv);

    expect(parsed.APP_NAME).toBe('Cordly');
    expect(parsed.MONGODB_MAX_POOL_SIZE).toBe(20);
    expect(parsed.BCRYPT_ROUNDS).toBe(12);
  });

  it('names missing and invalid variables in errors', () => {
    expect(() => parseEnv({ ...validEnv, MONGO_URL: undefined })).toThrow('MONGO_URL');
    expect(() => parseEnv({ ...validEnv, MONGO_URL: 'http://localhost' })).toThrow('MONGO_URL');
  });

  it('rejects weak production secrets and inconsistent pool settings', () => {
    expect(() => parseEnv({ ...validEnv, NODE_ENV: 'production', AUTH_SECRET: 'weak' })).toThrow(
      'AUTH_SECRET',
    );
    expect(() =>
      parseEnv({ ...validEnv, MONGODB_MAX_POOL_SIZE: '1', MONGODB_MIN_POOL_SIZE: '2' }),
    ).toThrow('MONGODB_MIN_POOL_SIZE');
  });
});
