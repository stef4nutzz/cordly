import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface FriendshipDocument {
  _id: Types.ObjectId;
  id: string;
  requesterId: Types.ObjectId;
  recipientId: Types.ObjectId;
  status: 'pending' | 'accepted' | 'blocked';
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const friendshipSchema = new Schema<FriendshipDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    requesterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'blocked'], default: 'pending', required: true },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'friendships', timestamps: true, strict: true, versionKey: false },
);

friendshipSchema.index(
  { requesterId: 1, recipientId: 1 },
  { unique: true, name: 'uniq_friendship_direction' },
);
friendshipSchema.index({ recipientId: 1, status: 1, createdAt: -1 }, { name: 'friend_requests_received' });

export const Friendship =
  models.Friendship ?? model<FriendshipDocument>('Friendship', friendshipSchema);
