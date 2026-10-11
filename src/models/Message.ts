import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface MessageDocument {
  _id: Types.ObjectId;
  id: string;
  channelId: Types.ObjectId;
  authorId: Types.ObjectId;
  content: string;
  reactions: Array<{ emoji: string; userId: Types.ObjectId }>;
  attachments: Types.ObjectId[];
  replyToId: string | null;
  pinnedAt: Date | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<MessageDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
    reactions: {
      type: [{ emoji: { type: String, required: true }, userId: { type: Schema.Types.ObjectId, ref: 'User', required: true } }],
      default: [],
    },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'ChannelAttachment' }], default: [] },
    replyToId: { type: String, default: null, maxlength: 40 },
    pinnedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    schemaVersion: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'messages', timestamps: true, strict: true, versionKey: false },
);

messageSchema.index({ channelId: 1, deletedAt: 1, createdAt: -1 }, { name: 'messages_by_channel' });
messageSchema.index({ authorId: 1, createdAt: -1 }, { name: 'messages_by_author' });

export const Message = models.Message ?? model<MessageDocument>('Message', messageSchema);
