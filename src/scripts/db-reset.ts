import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { connectToDatabase } from '../lib/db';
import { env } from '../lib/env';
import { logger } from '../lib/logger';

async function main() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Database reset is disabled when NODE_ENV=production.');
  }

  const mongoose = await connectToDatabase();
  const databaseName = mongoose.connection.name;

  try {
    const prompt = createInterface({ input: stdin, output: stdout });
    const confirmation = await prompt.question(
      `This permanently drops database "${databaseName}". Type the database name to continue: `,
    );
    prompt.close();

    if (confirmation !== databaseName) {
      throw new Error('Database name did not match. No database changes were made.');
    }

    await mongoose.connection.dropDatabase();
    console.log(`Database "${databaseName}" was dropped.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error({
    event: 'database_reset_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
