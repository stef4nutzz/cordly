import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const positiveInteger = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().trim().min(1).max(80).default('Cordly'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    MONGO_URL: z
      .string()
      .trim()
      .min(1, 'must be set to your MongoDB connection URI')
      .regex(/^mongodb(?:\+srv)?:\/\//, 'must be a valid mongodb:// or mongodb+srv:// URI'),
    MONGODB_MAX_POOL_SIZE: positiveInteger(1, 500).default(20),
    MONGODB_MIN_POOL_SIZE: positiveInteger(0, 500).default(2),
    AUTH_SECRET: z.string().min(1, 'must not be empty'),
    SESSION_MAX_AGE_DAYS: positiveInteger(1, 365).default(30),
    BCRYPT_ROUNDS: positiveInteger(4, 15).default(12),
    INITIAL_OWNER_EMAIL: z.preprocess(
      emptyToUndefined,
      z.string().email('must be a valid email address').optional(),
    ),
    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PORT: positiveInteger(1, 65535).default(587),
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
    EMAIL_FROM: z.preprocess(
      emptyToUndefined,
      z.string().email('must be a valid email address').optional(),
    ),
    UPLOAD_DIR: z.string().trim().min(1).default('./uploads'),
    MAX_UPLOAD_MB: positiveInteger(1, 1024).default(25),
    RATE_LIMIT_WINDOW_SECONDS: positiveInteger(1, 86400).default(60),
    RATE_LIMIT_MAX_REQUESTS: positiveInteger(1, 100000).default(100),
  })
  .superRefine((value, context) => {
    if (value.MONGODB_MIN_POOL_SIZE > value.MONGODB_MAX_POOL_SIZE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGODB_MIN_POOL_SIZE'],
        message: 'must be less than or equal to MONGODB_MAX_POOL_SIZE',
      });
    }

    if (value.NODE_ENV === 'production' && value.AUTH_SECRET.length < 32) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message: 'must be at least 32 characters in production',
      });
    }

    if (value.NODE_ENV === 'production' && value.AUTH_SECRET.startsWith('replace-with-')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message: 'must be replaced with a randomly generated secret in production',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid application environment configuration:\n${details}`);
  }
  return result.data;
}
