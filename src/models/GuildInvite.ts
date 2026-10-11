import { model, models, Schema, Types } from 'mongoose';

export interface GuildInviteDocument {
  _id: Types.ObjectId;
  code: string;
  guildId: Types.ObjectId;
  createdBy: Types.ObjectId;
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  createdAt: Date;
  updatedAt: Date;
}

const guildInviteSchema = new Schema<GuildInviteDocument>(
  {
    code: { type: String, required: true, unique: true, immutable: true },
    guildId: { type: Schema.Types.ObjectId, ref: 'Guild', required: true, immutable: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    expiresAt: { type: Date, default: null },
    maxUses: { type: Number, min: 1, default: null },
    uses: { type: Number, min: 0, default: 0 },
  },
  { collection: 'guild_invites', timestamps: true, strict: true, versionKey: false },
);

guildInviteSchema.index({ guildId: 1, createdAt: -1 }, { name: 'invites_by_guild' });
export const GuildInvite =
  models.GuildInvite ?? model<GuildInviteDocument>('GuildInvite', guildInviteSchema);
