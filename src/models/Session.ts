import { Schema, model, models, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface SessionDocument {
  _id: Types.ObjectId;
  id: string;
  userId: Types.ObjectId;
  tokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDocument>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => generatePublicId(),
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, minlength: 32, select: false },
    userAgent: { type: String, default: null, maxlength: 512 },
    ip: { type: String, default: null, maxlength: 64 },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  {
    collection: 'sessions',
    timestamps: true,
    strict: true,
    versionKey: false,
  },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_session_token_hash' });
sessionSchema.index({ userId: 1, revokedAt: 1 }, { name: 'sessions_by_user_revoked' });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_expiry_ttl' });

export const Session = models.Session ?? model<SessionDocument>('Session', sessionSchema);
