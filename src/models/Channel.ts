import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface ChannelDocument {
  _id: Types.ObjectId;
  id: string;
  guildId: Types.ObjectId;
  name: string;
  categoryId: Types.ObjectId | null;
  type: 'text';
  deletedAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const channelSchema = new Schema<ChannelDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    guildId: { type: Schema.Types.ObjectId, ref: 'Guild', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80, match: /^[a-z0-9-]+$/ },
    categoryId: { type: Schema.Types.ObjectId, ref: 'GuildCategory', default: null },
    type: { type: String, enum: ['text'], default: 'text', required: true },
    deletedAt: { type: Date, default: null },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'channels', timestamps: true, strict: true, versionKey: false },
);

channelSchema.index({ guildId: 1, deletedAt: 1, createdAt: 1 }, { name: 'channels_by_guild' });
channelSchema.index({ guildId: 1, name: 1 }, { unique: true, name: 'uniq_channel_name_per_guild' });

export const Channel = models.Channel ?? model<ChannelDocument>('Channel', channelSchema);
