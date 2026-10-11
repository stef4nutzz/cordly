import { connectToDatabase } from '../lib/db';
import { logger } from '../lib/logger';

async function main() {
  const mongoose = await connectToDatabase();
  const database = mongoose.connection.db;
  if (!database) throw new Error('MongoDB database is not available after connecting.');

  const collections = await database.listCollections({}, { nameOnly: true }).toArray();
  const details = await Promise.all(
    collections.map(async ({ name }) => {
      const collection = database.collection(name);
      const [count, indexes] = await Promise.all([
        collection.estimatedDocumentCount(),
        collection.indexes(),
      ]);
      return {
        collection: name,
        documents: count,
        indexes: indexes.map((index) => ({ name: index.name, keys: index.key })),
      };
    }),
  );

  console.log(JSON.stringify({ database: database.databaseName, status: 'connected', collections: details }, null, 2));
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({
    event: 'database_status_failed',
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
