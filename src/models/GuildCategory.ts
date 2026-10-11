import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface GuildCategoryDocument {
  _id: Types.ObjectId;
  id: string;
  guildId: Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<GuildCategoryDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    guildId: { type: Schema.Types.ObjectId, ref: 'Guild', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
  },
  { collection: 'guild_categories', timestamps: true, strict: true, versionKey: false },
);

schema.index({ guildId: 1, name: 1 }, { unique: true, name: 'uniq_category_name_per_guild' });
export const GuildCategory = models.GuildCategory ?? model<GuildCategoryDocument>('GuildCategory', schema);
