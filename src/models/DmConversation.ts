import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface DmConversationDocument {
  _id: Types.ObjectId;
  id: string;
  participantIds: Types.ObjectId[];
  key: string;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const dmConversationSchema = new Schema<DmConversationDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    participantIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }], required: true, validate: (ids: Types.ObjectId[]) => ids.length === 2 },
    key: { type: String, required: true, unique: true, immutable: true },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'dm_conversations', timestamps: true, strict: true, versionKey: false },
);

dmConversationSchema.index({ participantIds: 1, updatedAt: -1 }, { name: 'dm_conversations_by_participant' });

export const DmConversation =
  models.DmConversation ?? model<DmConversationDocument>('DmConversation', dmConversationSchema);
