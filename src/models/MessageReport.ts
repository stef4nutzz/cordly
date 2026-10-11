import { model, models, Schema, Types } from 'mongoose';

export interface MessageReportDocument {
  _id: Types.ObjectId;
  messageId: Types.ObjectId;
  reporterId: Types.ObjectId;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<MessageReportDocument>(
  {
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true, immutable: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  },
  { collection: 'message_reports', timestamps: true, strict: true, versionKey: false },
);

schema.index({ messageId: 1, reporterId: 1, status: 1 }, { name: 'reports_by_message_reporter' });
export const MessageReport = models.MessageReport ?? model<MessageReportDocument>('MessageReport', schema);
