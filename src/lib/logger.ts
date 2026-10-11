import pino from 'pino';

import { env } from './env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'tokenHash',
      'authorization',
      'cookie',
      'email',
      'ip',
    ],
    remove: true,
  },
});
