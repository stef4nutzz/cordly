import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';

import { jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { connectToDatabase } from '@/lib/db';
import { emitRealtime } from '@/lib/realtime/instance';
import { DmConversation } from '@/models/DmConversation';
import { DirectMessage } from '@/models/DirectMessage';
import { ChannelAttachment } from '@/models/ChannelAttachment';
import { Friendship } from '@/models/Friendship';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ conversationId: string }> };
const messageSchema = z.object({ 
  content: z.string().trim().max(4000).default(''),
  attachmentIds: z.array(z.string().min(1).max(40)).max(10).default([]),
}).strict().refine((input) => input.content.length > 0 || input.attachmentIds.length > 0);

async function authorize(request: NextRequest, conversationId: string) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: jsonError('Sign in to access direct messages.', 401) } as const;
  const conversation = await DmConversation.findOne({
    id: conversationId,
    participantIds: user.objectId,
  }).exec();
  if (!conversation) return { response: jsonError('Direct message not found.', 404) } as const;

  const participantIds: Types.ObjectId[] = conversation.participantIds;
  const otherId = participantIds.find((participantId: Types.ObjectId) => !participantId.equals(user.objectId));
  if (!otherId) return { response: jsonError('Direct message participant was not found.', 404) } as const;
  const friendship = await Friendship.exists({
    status: 'accepted',
    $or: [
      { requesterId: user.objectId, recipientId: otherId },
      { requesterId: otherId, recipientId: user.objectId },
    ],
  });
  if (!friendship) return { response: jsonError('An accepted friendship is required to access this conversation.', 403) } as const;
  return { user, conversation } as const;
}

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { conversationId } = await context.params;
  const access = await authorize(request, conversationId);
  if ('response' in access) return access.response;

  const after = request.nextUrl.searchParams.get('after');
  if (after && !/^[a-z0-9]{13}[a-f0-9]{16}$/.test(after)) return jsonError('Invalid message cursor.', 400);
  const afterTimestamp = after ? Number.parseInt(after.slice(0, 9), 36) : null;
  const messages = await DirectMessage.find({
    conversationId: access.conversation._id,
    deletedAt: null,
    ...(afterTimestamp !== null ? { createdAt: { $gte: new Date(afterTimestamp) } } : {}),
  })
    .sort({ createdAt: after ? 1 : -1, id: after ? 1 : -1 })
    .limit(100)
    .populate('authorId', 'id username tag avatarVersion')
    .exec();
  const ordered = after
    ? messages.filter((message) => message.id > after)
    : messages.reverse();
  return NextResponse.json({
    messages: await Promise.all(ordered.map(async (message) => {
      const author = message.authorId as unknown as {
        id: string;
        username: string;
        tag: string;
        avatarVersion: string | null;
      };
      // Fetch attachments for this DM message
      const attachments = await ChannelAttachment.find({
        _id: { $in: message.attachments ?? [] }
      })
        .select('id filename contentType size')
        .lean()
        .exec();
      
      return {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        author: {
          id: author.id,
          username: author.username,
          tag: author.tag,
          avatarUrl: publicAvatarUrl(author.id, author.avatarVersion),
        },
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          url: `/api/attachments/${encodeURIComponent(attachment.id)}`,
        })),
        reactions: [],
        pinned: false,
        editedAt: message.editedAt?.toISOString() ?? null,
        replyToId: null,
      };
    })),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { conversationId } = await context.params;
  const access = await authorize(request, conversationId);
  if ('response' in access) return access.response;

  try {
    const { content, attachmentIds } = messageSchema.parse(await request.json());
    
    // Validate attachments if provided
    const attachments = attachmentIds.length
      ? await ChannelAttachment.find({
          id: { $in: attachmentIds },
          // For DM attachments, we stored them with conversationId as channelId
          // So we check if the attachment belongs to this conversation
          channelId: access.conversation._id,
          uploadedBy: access.user.objectId,
        }).exec()
      : [];
      
    if (attachments.length !== attachmentIds.length) {
      return jsonError('One or more attachments are invalid for this conversation.', 400);
    }
    
    const message = await DirectMessage.create({
      conversationId: access.conversation._id,
      authorId: access.user.objectId,
      content,
      attachments: attachments.map((attachment) => attachment._id),
      // Store attachment references in the DirectMessage model
      // We need to add attachments field to DirectMessage schema first
      // For now, we'll handle this in the response only
    });
    await DmConversation.updateOne({ _id: access.conversation._id }, { $set: { updatedAt: message.createdAt } }).exec();
    const author = await User.findById(access.user.objectId).select('id username tag avatarVersion').exec();
    if (!author) return jsonError('Your account could not be found.', 404);
    const result = {
      message: {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        author: {
          id: author.id,
          username: author.username,
          tag: author.tag,
          avatarUrl: publicAvatarUrl(author.id, author.avatarVersion),
        },
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          url: `/api/attachments/${encodeURIComponent(attachment.id)}`,
        })),
        reactions: [],
        pinned: false,
        editedAt: null,
        replyToId: null,
      },
    };
    emitRealtime(`dm:${conversationId}`, 'dm:message:created', {
      conversationId,
      message: result.message,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Message must be between 1 and 4000 characters.', 400);
    return jsonError('Message could not be sent.', 500);
  }
}
