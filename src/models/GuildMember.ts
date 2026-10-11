import { model, models, Schema, Types } from 'mongoose';

export interface GuildMemberDocument {
  _id: Types.ObjectId;
  guildId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'owner' | 'member';
  preferences: {
    notificationLevel: 'all' | 'mentions' | 'nothing';
    suppressEveryone: boolean;
    suppressRoles: boolean;
    muteUntil: Date | null;
    allowMemberDms: boolean;
    showActivity: boolean;
    hideMutedChannels: boolean;
    favoriteChannelIds: string[];
  };
  profile: { nickname: string; bio: string };
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const preferencesSchema = new Schema(
  {
    notificationLevel: { type: String, enum: ['all', 'mentions', 'nothing'], default: 'all' },
    suppressEveryone: { type: Boolean, default: false },
    suppressRoles: { type: Boolean, default: false },
    muteUntil: { type: Date, default: null },
    allowMemberDms: { type: Boolean, default: true },
    showActivity: { type: Boolean, default: true },
    hideMutedChannels: { type: Boolean, default: false },
    favoriteChannelIds: { type: [String], default: [] },
  },
  { _id: false, strict: true },
);

const profileSchema = new Schema(
  {
    nickname: { type: String, default: '', maxlength: 32 },
    bio: { type: String, default: '', maxlength: 190 },
  },
  { _id: false, strict: true },
);

const guildMemberSchema = new Schema<GuildMemberDocument>(
  {
    guildId: { type: Schema.Types.ObjectId, ref: 'Guild', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member', required: true },
    preferences: { type: preferencesSchema, default: () => ({}) },
    profile: { type: profileSchema, default: () => ({}) },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'guild_members', timestamps: true, strict: true, versionKey: false },
);

guildMemberSchema.index({ guildId: 1, userId: 1 }, { unique: true, name: 'uniq_guild_member' });
guildMemberSchema.index({ userId: 1, createdAt: -1 }, { name: 'guilds_by_member' });

export const GuildMember =
  models.GuildMember ?? model<GuildMemberDocument>('GuildMember', guildMemberSchema);
