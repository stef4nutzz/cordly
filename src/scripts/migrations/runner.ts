import type { Connection } from 'mongoose';
type MigrationRecord = {
  _id: string;
  description: string;
  appliedAt: Date;
};

type Migration = {
  id: string;
  description: string;
  up: (connection: Connection, models: string[]) => Promise<void>;
};

const foundationMigration: Migration = {
  id: '0001-foundation-collections-and-indexes',
  description: 'Create foundation collections and declared indexes',
  async up(connection, modelNames) {
    const database = connection.db;
    if (!database) throw new Error('MongoDB database is not available after connecting.');

    const existing = new Set(
      (await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name),
    );
    for (const modelName of modelNames) {
      const model = connection.models[modelName];
      if (!model) throw new Error(`Mongoose model "${modelName}" is not registered.`);
      if (!existing.has(model.collection.name)) {
        await database.createCollection(model.collection.name);
      }
      await model.createIndexes();
    }
  },
};

export async function runMigrations(connection: Connection, modelNames: string[]): Promise<string[]> {
  const database = connection.db;
  if (!database) throw new Error('MongoDB database is not available after connecting.');

  const migrations = database.collection<MigrationRecord>('migrations');
  await migrations.createIndex({ appliedAt: 1 }, { name: 'migrations_applied_at' });
  const applied: string[] = [];

  for (const migration of [foundationMigration]) {
    const alreadyApplied = await migrations.findOne({ _id: migration.id });
    await migration.up(connection, modelNames);
    if (!alreadyApplied) {
      await migrations.updateOne(
        { _id: migration.id },
        {
          $setOnInsert: {
            description: migration.description,
            appliedAt: new Date(),
          },
        },
        { upsert: true },
      );
      applied.push(migration.id);
    }
  }

  return applied;
}
