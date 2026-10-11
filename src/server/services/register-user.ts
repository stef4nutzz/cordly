import bcrypt from 'bcryptjs';
import type { HydratedDocument } from 'mongoose';
import { z } from 'zod';

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { User, type PlatformRole, type UserDocument, type UserStatus } from '@/models/User';

import { allocateUniqueTag, shouldGrantInitialOwner } from './account-foundation';

const registrationSchema = z.object({
  email: z.string().trim().email().max(254),
  username: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(128),
  dateOfBirth: z.coerce.date(),
});

export type RegisterUserInput = z.input<typeof registrationSchema>;

export type RegisteredUser = {
  id: string;
  username: string;
  tag: string;
  status: UserStatus;
  platformRole: PlatformRole;
  avatarUrl: string | null;
};

function isDuplicateIndex(error: unknown, indexField: string): boolean {
  if (!(error instanceof Error) || !('code' in error) || !('keyPattern' in error)) return false;
  const code = error.code;
  const keyPattern = error.keyPattern;
  return (
    code === 11000 &&
    typeof keyPattern === 'object' &&
    keyPattern !== null &&
    indexField in keyPattern
  );
}

export async function registerUser(input: unknown): Promise<RegisteredUser & { internalId: string }> {
  const registration = registrationSchema.parse(input);
  const email = registration.email.toLowerCase();
  const username = registration.username.trim();
  const usernameLower = username.toLowerCase();
  const passwordHash = await bcrypt.hash(registration.password, env.BCRYPT_ROUNDS);
  let user: HydratedDocument<UserDocument> | undefined;

  for (let attempt = 0; attempt < 5 && !user; attempt += 1) {
    const existingUsers = await User.find({ usernameLower })
      .select({ tag: 1, _id: 0 })
      .lean()
      .exec();
    const existingTags = new Set(existingUsers.map((existingUser) => existingUser.tag));
    const tag = allocateUniqueTag(existingTags);

    try {
      user = await User.create({
        username,
        usernameLower,
        tag,
        email,
        passwordHash,
        dateOfBirth: registration.dateOfBirth,
      });
    } catch (error) {
      if (!isDuplicateIndex(error, 'usernameLower') || !isDuplicateIndex(error, 'tag')) {
        throw error;
      }
    }
  }

  if (!user) {
    throw new Error('Could not allocate a unique username tag. Please try again.');
  }

  const [existingOwner, existingBootstrap] = await Promise.all([
    User.exists({ platformRole: 'owner' }),
    User.exists({ initialOwnerBootstrap: true }),
  ]);
  const eligible = shouldGrantInitialOwner(
    email,
    env.INITIAL_OWNER_EMAIL,
    Boolean(existingOwner || existingBootstrap),
  );

  if (eligible) {
    try {
      const owner = await User.findOneAndUpdate(
        { _id: user._id, initialOwnerBootstrap: false },
        { $set: { platformRole: 'owner', initialOwnerBootstrap: true } },
        { new: true },
      )
        .select('+initialOwnerBootstrap')
        .exec();

      if (owner) {
        user.platformRole = 'owner';
        logger.info({ event: 'initial_platform_owner_granted' });
      }
    } catch (error) {
      if (!isDuplicateIndex(error, 'initialOwnerBootstrap')) throw error;
    }
  }

  return {
    internalId: user._id.toString(),
    id: user.id,
    username: user.username,
    tag: user.tag,
    status: user.status,
    platformRole: user.platformRole,
    avatarUrl: null,
  };
}
