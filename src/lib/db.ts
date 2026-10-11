import mongoose from 'mongoose';

import { env } from './env';

type MongooseCache = {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var mongooseCache: MongooseCache | undefined;
}

const cache = (globalThis.mongooseCache ??= { connection: null, promise: null });

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.connection?.connection.readyState === 1) return cache.connection;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.MONGO_URL, {
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        minPoolSize: env.MONGODB_MIN_POOL_SIZE,
        serverSelectionTimeoutMS: 5000,
        autoIndex: env.NODE_ENV !== 'production',
      })
      .then((connection) => {
        cache.connection = connection;
        return connection;
      })
      .catch((error: unknown) => {
        cache.promise = null;
        throw error;
      });
  }

  return cache.promise;
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
