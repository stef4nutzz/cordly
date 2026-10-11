import { model, models, Schema, Types } from 'mongoose';

import { generatePublicId } from '@/lib/ids';

export interface ChannelAttachmentDocument {
  _id: Types.ObjectId;
  id: string;
  channelId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  filename: string;
  contentType: string;
  data: Buffer;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ChannelAttachmentDocument>(
  {
    id: { type: String, required: true, unique: true, immutable: true, default: () => generatePublicId() },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, immutable: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    filename: { type: String, required: true, maxlength: 180 },
    contentType: { type: String, required: true, maxlength: 100 },
    data: { type: Buffer, required: true, select: false },
    size: { type: Number, required: true, min: 1 },
  },
  { collection: 'channel_attachments', timestamps: true, strict: true, versionKey: false },
);

schema.index({ channelId: 1, uploadedBy: 1, createdAt: -1 }, { name: 'attachments_by_channel_user' });
export const ChannelAttachment =
  models.ChannelAttachment ?? model<ChannelAttachmentDocument>('ChannelAttachment', schema);
