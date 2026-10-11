import { randomBytes } from 'node:crypto';
import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface GuildDocument {
  _id: Types.ObjectId;
  id: string;
  name: string;
  detachedBanner: boolean;
  ownerId: Types.ObjectId;
  inviteCode: string;
  deletedAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const guildSchema = new Schema<GuildDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    detachedBanner: { type: Boolean, default: false },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => randomBytes(9).toString('base64url'),
    },
    deletedAt: { type: Date, default: null },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'guilds', timestamps: true, strict: true, versionKey: false },
);

guildSchema.index({ ownerId: 1, deletedAt: 1 }, { name: 'guilds_by_owner' });
export const Guild = models.Guild ?? model<GuildDocument>('Guild', guildSchema);
