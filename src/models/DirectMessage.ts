import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface DirectMessageDocument {
  _id: Types.ObjectId;
  id: string;
  conversationId: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  attachments: Types.ObjectId[];
  editedAt: Date | null;
  deletedAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const directMessageSchema = new Schema<DirectMessageDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    conversationId: { type: Schema.Types.ObjectId, ref: 'DmConversation', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'ChannelAttachment' }], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'direct_messages', timestamps: true, strict: true, versionKey: false },
);

directMessageSchema.index({ conversationId: 1, deletedAt: 1, createdAt: -1 }, { name: 'direct_messages_by_conversation' });
directMessageSchema.index({ authorId: 1, createdAt: -1 }, { name: 'direct_messages_by_author' });

export const DirectMessage =
  models.DirectMessage ?? model<DirectMessageDocument>('DirectMessage', directMessageSchema);
