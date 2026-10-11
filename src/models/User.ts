import { Schema, model, models, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export const PLATFORM_ROLES = ['none', 'support', 'moderator', 'admin', 'owner'] as const;
export const USER_STATUSES = ['online', 'idle', 'dnd', 'offline'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];

export interface UserDocument {
  _id: Types.ObjectId;
  id: string;
  username: string;
  usernameLower: string;
  tag: string;
  avatarData?: Buffer;
  avatarContentType?: string;
  avatarVersion: string | null;
  bannerData?: Buffer;
  bannerContentType?: string;
  bannerVersion: string | null;
  email: string;
  passwordHash: string;
  totpSecretEncrypted: string | null;
  totpEnabled: boolean;
  backupCodeHashes: string[];
  dateOfBirth: Date;
  emailVerifiedAt: Date | null;
  status: UserStatus;
  platformRole: PlatformRole;
  initialOwnerBootstrap: boolean;
  onboardingCompletedAt: Date | null;
  disabledAt: Date | null;
  deletedAt: Date | null;
  lastLoginAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => generatePublicId(),
    },
    username: { type: String, required: true, trim: true, minlength: 2, maxlength: 32 },
    usernameLower: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      minlength: 2,
      maxlength: 32,
    },
    tag: { type: String, required: true, match: /^\d{4}$/ },
    avatarData: { type: Buffer, select: false },
    avatarContentType: { type: String, select: false, enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
    avatarVersion: { type: String, default: null },
    bannerData: { type: Buffer, select: false },
    bannerContentType: { type: String, select: false, enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
    bannerVersion: { type: String, default: null },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: { type: String, required: true, minlength: 20 },
    totpSecretEncrypted: { type: String, default: null, select: false },
    totpEnabled: { type: Boolean, default: false },
    backupCodeHashes: { type: [String], default: [], select: false },
    dateOfBirth: { type: Date, required: true },
    emailVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: USER_STATUSES, default: 'offline', required: true },
    platformRole: { type: String, enum: PLATFORM_ROLES, default: 'none', required: true },
    initialOwnerBootstrap: { type: Boolean, default: false, select: false },
    onboardingCompletedAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  {
    collection: 'users',
    timestamps: true,
    strict: true,
    versionKey: false,
  },
);

userSchema.pre('validate', function normalizeUsername() {
  this.usernameLower = this.username.toLowerCase();
});

userSchema.index({ usernameLower: 1, tag: 1 }, { unique: true, name: 'uniq_username_tag' });
userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
userSchema.index(
  { platformRole: 1 },
  {
    name: 'platform_role_lookup',
    partialFilterExpression: { platformRole: { $in: ['support', 'moderator', 'admin', 'owner'] } },
  },
);
userSchema.index(
  { initialOwnerBootstrap: 1 },
  {
    unique: true,
    name: 'initial_owner_bootstrap_once',
    partialFilterExpression: { initialOwnerBootstrap: true },
  },
);
userSchema.index({ deletedAt: 1 }, { name: 'user_deleted_at' });

export const User = models.User ?? model<UserDocument>('User', userSchema);
