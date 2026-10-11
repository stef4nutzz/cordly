import { model, models, Schema, Types } from 'mongoose';

export interface ChannelTypingDocument {
  _id: Types.ObjectId;
  channelId: Types.ObjectId;
  userId: Types.ObjectId;
  expiresAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ChannelTypingDocument>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'channel_typing', timestamps: { createdAt: false, updatedAt: true }, strict: true, versionKey: false },
);

schema.index({ channelId: 1, userId: 1 }, { unique: true, name: 'uniq_channel_typing_user' });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'channel_typing_expiry' });
export const ChannelTyping = models.ChannelTyping ?? model<ChannelTypingDocument>('ChannelTyping', schema);
