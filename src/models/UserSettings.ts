import { model, models, Schema, Types } from 'mongoose';

export type ThemePreference = 'oled' | 'dark' | 'light' | 'system';
export type MessageLayout = 'cozy' | 'compact';
export type NotificationLevel = 'all' | 'mentions' | 'nothing';

export interface UserProfileSettings {
  displayName: string;
  pronouns: string;
  bio: string;
  timezone: string;
  accentColor: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface UserPreferences {
  appearance: {
    theme: ThemePreference;
    messageLayout: MessageLayout;
    fontSize: number;
    groupSpacing: number;
    zoom: number;
    roleColors: boolean;
    saturation: number;
  };
  notifications: {
    desktopPush: boolean;
    sounds: boolean;
    soundVolume: number;
    unreadBadges: boolean;
    quietHours: boolean;
  };
  privacy: {
    directMessages: 'everyone' | 'friends' | 'nobody';
    friendRequests: 'everyone' | 'mutuals' | 'nobody';
    explicitMediaFilter: boolean;
    showActivity: boolean;
    readReceipts: boolean;
  };
  chat: {
    linkPreviews: boolean;
    inlineAttachments: boolean;
    convertEmoticons: boolean;
    hideSpoilers: boolean;
    gifAutoplay: boolean;
    sendOnEnter: boolean;
    clockFormat: '12h' | '24h';
  };
  accessibility: {
    reducedMotion: boolean;
    highContrast: boolean;
    underlineLinks: boolean;
    keyboardFocus: boolean;
    animatedEmoji: boolean;
  };
  language: string;
  developerMode: boolean;
}

export interface UserSettingsDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  schemaVersion: number;
  profile: UserProfileSettings;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<UserProfileSettings>(
  {
    displayName: { type: String, default: '', maxlength: 32 },
    pronouns: { type: String, default: '', maxlength: 40 },
    bio: { type: String, default: '', maxlength: 190 },
    timezone: { type: String, default: 'UTC', maxlength: 64 },
    accentColor: { type: String, default: '#0A0A0A', match: /^#[0-9a-fA-F]{6}$/ },
    primaryColor: { type: String, default: '#4F46E5', match: /^#[0-9a-fA-F]{6}$/ },
    secondaryColor: { type: String, default: '#0A0A0A', match: /^#[0-9a-fA-F]{6}$/ },
  },
  { _id: false, strict: true },
);

const preferencesSchema = new Schema<UserPreferences>(
  {
    appearance: {
      theme: { type: String, enum: ['oled', 'dark', 'light', 'system'], default: 'oled' },
      messageLayout: { type: String, enum: ['cozy', 'compact'], default: 'cozy' },
      fontSize: { type: Number, min: 12, max: 20, default: 14 },
      groupSpacing: { type: Number, min: 0, max: 32, default: 16 },
      zoom: { type: Number, min: 80, max: 120, default: 100 },
      roleColors: { type: Boolean, default: true },
      saturation: { type: Number, min: 0, max: 100, default: 100 },
    },
    notifications: {
      desktopPush: { type: Boolean, default: false },
      sounds: { type: Boolean, default: true },
      soundVolume: { type: Number, min: 0, max: 100, default: 50 },
      unreadBadges: { type: Boolean, default: true },
      quietHours: { type: Boolean, default: false },
    },
    privacy: {
      directMessages: { type: String, enum: ['everyone', 'friends', 'nobody'], default: 'friends' },
      friendRequests: { type: String, enum: ['everyone', 'mutuals', 'nobody'], default: 'everyone' },
      explicitMediaFilter: { type: Boolean, default: true },
      showActivity: { type: Boolean, default: true },
      readReceipts: { type: Boolean, default: true },
    },
    chat: {
      linkPreviews: { type: Boolean, default: true },
      inlineAttachments: { type: Boolean, default: true },
      convertEmoticons: { type: Boolean, default: true },
      hideSpoilers: { type: Boolean, default: true },
      gifAutoplay: { type: Boolean, default: false },
      sendOnEnter: { type: Boolean, default: true },
      clockFormat: { type: String, enum: ['12h', '24h'], default: '24h' },
    },
    accessibility: {
      reducedMotion: { type: Boolean, default: false },
      highContrast: { type: Boolean, default: false },
      underlineLinks: { type: Boolean, default: false },
      keyboardFocus: { type: Boolean, default: true },
      animatedEmoji: { type: Boolean, default: true },
    },
    language: { type: String, default: 'en', maxlength: 16 },
    developerMode: { type: Boolean, default: false },
  },
  { _id: false, strict: true },
);

const userSettingsSchema = new Schema<UserSettingsDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
    profile: { type: profileSchema, default: () => ({}) },
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  { collection: 'user_settings', timestamps: true, strict: true, versionKey: false },
);

export const UserSettings =
  models.UserSettings ?? model<UserSettingsDocument>('UserSettings', userSettingsSchema);
