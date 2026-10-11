import { model, models, Schema, Types } from 'mongoose';

export interface UsernameChangeDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  createdAt: Date;
}

const schema = new Schema<UsernameChangeDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  },
  { collection: 'username_changes', timestamps: { createdAt: true, updatedAt: false }, strict: true, versionKey: false },
);

schema.index({ userId: 1, createdAt: -1 }, { name: 'username_changes_by_user' });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400, name: 'username_changes_ttl' });
export const UsernameChange = models.UsernameChange ?? model<UsernameChangeDocument>('UsernameChange', schema);
