import { connectToDatabase } from '../lib/db';
import { logger } from '../lib/logger';
import { PLATFORM_ROLES, User, type PlatformRole } from '../models/User';

async function main() {
  const [account, requestedRole] = process.argv.slice(2);
  const match = account?.match(/^(.+)#(\d{4})$/);
  if (!match) {
    throw new Error('Usage: npm run staff:promote -- <username#tag> [support|moderator|admin|owner]');
  }

  const role = requestedRole ?? 'owner';
  const platformRole = PLATFORM_ROLES.find(
    (candidate): candidate is Exclude<PlatformRole, 'none'> =>
      candidate !== 'none' && candidate === role,
  );
  if (!platformRole) {
    throw new Error(`Role must be one of: ${PLATFORM_ROLES.filter((item) => item !== 'none').join(', ')}.`);
  }

  const mongoose = await connectToDatabase();
  const user = await User.findOne({
    usernameLower: match[1].toLowerCase(),
    tag: match[2],
    deletedAt: null,
  }).exec();

  if (!user) {
    throw new Error(`No existing account matches "${match[1]}#${match[2]}".`);
  }

  user.platformRole = platformRole;
  await user.save();
  console.log(`Platform role "${platformRole}" granted to ${user.username}#${user.tag}.`);
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({
    event: 'staff_promotion_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
