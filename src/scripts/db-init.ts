import { connectToDatabase } from '../lib/db';
import { logger } from '../lib/logger';
import { Channel } from '../models/Channel';
import { DirectMessage } from '../models/DirectMessage';
import { DmConversation } from '../models/DmConversation';
import { Friendship } from '../models/Friendship';
import { Guild } from '../models/Guild';
import { GuildMember } from '../models/GuildMember';
import { Message } from '../models/Message';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { runMigrations } from './migrations/runner';

async function main() {
  const mongoose = await connectToDatabase();
  const models = [User, Session, Guild, GuildMember, Channel, Message, Friendship, DmConversation, DirectMessage];
  const applied = await runMigrations(
    mongoose.connection,
    models.map((model) => model.modelName),
  );

  console.log(
    JSON.stringify(
      {
        database: mongoose.connection.name,
        status: 'initialized',
        migrationsApplied: applied,
        collections: [...models.map((model) => model.collection.name), 'migrations'],
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({
    event: 'database_initialization_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
