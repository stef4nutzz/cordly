import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { env } from '@/lib/env';
import { ChannelAttachment } from '@/models/ChannelAttachment';
import { DmConversation } from '@/models/DmConversation';
import { Friendship } from '@/models/Friendship';
import { getAuthenticatedUser } from '@/server/services/session-service';
import { User } from '@/models/User';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ conversationId: string }> };
const allowedTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'application/pdf', 'text/plain',
]);

function hasValidSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/gif') return String.fromCharCode(...bytes.slice(0, 3)) === 'GIF';
  if (contentType === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (contentType === 'video/mp4') return String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  if (contentType === 'video/webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (contentType === 'application/pdf') return String.fromCharCode(...bytes.slice(0, 4)) === '%PDF';
  if (contentType === 'image/avif') return String.fromCharCode(...bytes.slice(4, 12)).includes('ftypavif');
  return contentType === 'text/plain' && !bytes.slice(0, 512).includes(0);
}

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to upload DM attachments.', 401);
  const { conversationId } = await context.params;
  
  const conversation = await DmConversation.findOne({
    id: conversationId,
    participantIds: user.objectId,
  }).exec();
  
  if (!conversation) return jsonError('Direct message conversation not found.', 404);
  
  const participantIds = conversation.participantIds as Types.ObjectId[];
  const otherId = participantIds.find((participantId) => !participantId.equals(user.objectId));
  if (!otherId) return jsonError('Direct message participant was not found.', 404);
  
  const friendship = await Friendship.exists({
    status: 'accepted',
    $or: [
      { requesterId: user.objectId, recipientId: otherId },
      { requesterId: otherId, recipientId: user.objectId },
    ],
  });
  
  if (!friendship) return jsonError('An accepted friendship is required to access this conversation.', 403);
  
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return jsonError('Choose a file to upload.', 400);
  
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size < 1 || file.size > maxBytes) return jsonError(`Files must be smaller than ${env.MAX_UPLOAD_MB} MB.`, 413);
  
  if (!allowedTypes.has(file.type)) return jsonError('This file type is not supported.', 415);
  
  const data = Buffer.from(await file.arrayBuffer());
  if (!hasValidSignature(data, file.type)) return jsonError('The file content does not match its declared type.', 415);
  
  const attachment = await ChannelAttachment.create({
    channelId: conversation._id,
    uploadedBy: user.objectId,
    filename: file.name.replace(/[^\w .()-]/g, '_').slice(0, 180) || 'attachment',
    contentType: file.type,
    data,
    size: data.byteLength,
  });
  
  return NextResponse.json({
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      url: `/api/attachments/${encodeURIComponent(attachment.id)}`,
    },
  }, { status: 201 });
}