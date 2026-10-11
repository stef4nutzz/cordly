import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';

import { jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { connectToDatabase } from '@/lib/db';
import { emitRealtime } from '@/lib/realtime/instance';
import { Channel } from '@/models/Channel';
import { ChannelAttachment } from '@/models/ChannelAttachment';
import { GuildMember } from '@/models/GuildMember';
import { Message } from '@/models/Message';
import { MessageReport } from '@/models/MessageReport';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ channelId: string }> };

async function getAuthorizedChannel(request: NextRequest, channelId: string) {
  const user = await getAuthenticatedUser(request);
  if (!user) return { response: jsonError('Sign in to read messages.', 401) } as const;

  const channel = await Channel.findOne({ id: channelId, deletedAt: null }).select('_id guildId').exec();
  if (!channel) return { response: jsonError('Channel not found.', 404) } as const;

  const member = await GuildMember.exists({ guildId: channel.guildId, userId: user.objectId });
  if (!member) return { response: jsonError('You are not a member of this community.', 403) } as const;
  return { channel, user } as const;
}

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { channelId } = await context.params;
  const access = await getAuthorizedChannel(request, channelId);
  if ('response' in access) return access.response;

  const after = request.nextUrl.searchParams.get('after');
  const pinnedOnly = request.nextUrl.searchParams.get('pinned') === '1';
  const replyTo = request.nextUrl.searchParams.get('replyTo');
  if (after && !/^[a-z0-9]{13}[a-f0-9]{16}$/.test(after)) {
    return jsonError('Invalid message cursor.', 400);
  }
  const afterTimestamp = after ? Number.parseInt(after.slice(0, 9), 36) : null;
  if (afterTimestamp !== null && !Number.isSafeInteger(afterTimestamp)) {
    return jsonError('Invalid message cursor.', 400);
  }

  let messages = await Message.find({
    channelId: access.channel._id,
    deletedAt: null,
    ...(pinnedOnly ? { pinnedAt: { $ne: null } } : {}),
    ...(replyTo ? { replyToId: replyTo } : {}),
    ...(afterTimestamp !== null ? { createdAt: { $gte: new Date(afterTimestamp) } } : {}),
  })
    .sort({ createdAt: after ? 1 : -1, id: after ? 1 : -1 })
    .limit(100)
    .populate('authorId', 'id username tag avatarVersion')
    .exec();

  if (after) {
    messages = messages.filter((message) => message.id > after);
  } else {
    messages.reverse();
  }
  return NextResponse.json({
    messages: await Promise.all(messages.map(async (message) => {
      const author = message.authorId as unknown as {
        id: string;
        username: string;
        tag: string;
        avatarVersion: string | null;
      };
      const attachments = await ChannelAttachment.find({ _id: { $in: message.attachments ?? [] } })
        .select('id filename contentType size')
        .lean()
        .exec();
      const reactions = ((message.reactions ?? []) as Array<{ emoji: string; userId: Types.ObjectId }>).reduce(
        (result: Array<{ emoji: string; count: number; reacted: boolean }>, reaction) => {
          let entry = result.find((item) => item.emoji === reaction.emoji);
          if (!entry) {
            entry = { emoji: reaction.emoji, count: 0, reacted: false };
            result.push(entry);
          }
          entry.count += 1;
          if (reaction.userId.equals(access.user.objectId)) entry.reacted = true;
          return result;
        },
        [],
      );
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
        reactions,
        pinned: Boolean(message.pinnedAt),
        editedAt: message.editedAt?.toISOString() ?? null,
        replyToId: message.replyToId ?? null,
      };
    })),
  });
}

const createMessageSchema = z.object({
  content: z.string().trim().max(4000).default(''),
  attachmentIds: z.array(z.string().min(1).max(40)).max(10).default([]),
  replyToId: z.string().min(1).max(40).optional(),
}).strict().refine((input) => input.content.length > 0 || input.attachmentIds.length > 0);

export async function POST(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const { channelId } = await context.params;
  const access = await getAuthorizedChannel(request, channelId);
  if ('response' in access) return access.response;

  try {
    const input = createMessageSchema.parse(await request.json());
    const attachments = input.attachmentIds.length
      ? await ChannelAttachment.find({
          id: { $in: input.attachmentIds },
          channelId: access.channel._id,
          uploadedBy: access.user.objectId,
        }).exec()
      : [];
    if (attachments.length !== input.attachmentIds.length) {
      return jsonError('One or more attachments are invalid for this channel.', 400);
    }
    if (input.replyToId && !(await Message.exists({
      id: input.replyToId,
      channelId: access.channel._id,
      deletedAt: null,
    }))) return jsonError('The message you are replying to could not be found.', 404);
    const message = await Message.create({
      channelId: access.channel._id,
      authorId: access.user.objectId,
      content: input.content,
      attachments: attachments.map((attachment) => attachment._id),
      replyToId: input.replyToId ?? null,
    });
    const result = {
      message: {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          author: {
            id: access.user.id,
            username: access.user.username,
            tag: access.user.tag,
            avatarUrl: access.user.avatarUrl,
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
          replyToId: message.replyToId,
      },
    };
    emitRealtime(`channel:${channelId}`, 'message:created', result.message);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Message must be between 1 and 4000 characters.', 400);
    return jsonError('Message could not be sent.', 500);
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), content: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ action: z.literal('delete') }).strict(),
  z.object({ action: z.literal('pin') }).strict(),
  z.object({ action: z.literal('report') }).strict(),
  z.object({ action: z.literal('react'), emoji: z.enum(['👍', '❤️', '😂', '🎉', '👀']) }).strict(),
]);

export async function PATCH(request: NextRequest, context: RouteContext) {
    await connectToDatabase();
    const { channelId } = await context.params;
    const access = await getAuthorizedChannel(request, channelId);
    if ('response' in access) return access.response;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError('The message action is invalid.', 400);
    const messageId = request.nextUrl.searchParams.get('messageId');
    if (!messageId) return jsonError('A message id is required.', 400);
    const message = await Message.findOne({ id: messageId, channelId: access.channel._id, deletedAt: null }).exec();
    if (!message) return jsonError('Message not found.', 404);
    const membership = await GuildMember.findOne({ guildId: access.channel.guildId, userId: access.user.objectId }).select('role').exec();
    if (!membership) return jsonError('You are not a member of this community.', 403);

    if (parsed.data.action === 'edit') {
      if (!message.authorId.equals(access.user.objectId)) return jsonError('You can only edit your own messages.', 403);
      message.content = parsed.data.content;
      message.editedAt = new Date();
      await message.save();
      emitRealtime(`channel:${channelId}`, 'message:updated', {
        id: message.id,
        action: 'edit',
        content: message.content,
        editedAt: message.editedAt?.toISOString() ?? null,
      });
    } else if (parsed.data.action === 'delete') {
      if (!message.authorId.equals(access.user.objectId) && membership.role !== 'owner') {
        return jsonError('You do not have permission to delete this message.', 403);
      }
      message.deletedAt = new Date();
      await message.save();
      emitRealtime(`channel:${channelId}`, 'message:deleted', { id: message.id });
      return NextResponse.json({ success: true, deleted: true });
    } else if (parsed.data.action === 'pin') {
      if (membership.role !== 'owner') return jsonError('Only the community owner can pin messages.', 403);
      message.pinnedAt = message.pinnedAt ? null : new Date();
      await message.save();
      emitRealtime(`channel:${channelId}`, 'message:updated', {
        id: message.id,
        action: 'pin',
        pinned: Boolean(message.pinnedAt),
      });
    } else if (parsed.data.action === 'react') {
      const emoji = parsed.data.emoji;
      const reactions = message.reactions as Array<{ emoji: string; userId: Types.ObjectId }>;
      const found = reactions.find((reaction) => reaction.emoji === emoji && reaction.userId.equals(access.user.objectId));
      if (found) {
        message.reactions = reactions.filter((reaction) => !(reaction.emoji === emoji && reaction.userId.equals(access.user.objectId)));
      } else {
        message.reactions.push({ emoji, userId: access.user.objectId });
      }
      await message.save();
      emitRealtime(`channel:${channelId}`, 'message:updated', {
        id: message.id,
        action: 'react',
        emoji,
        userId: access.user.id,
        added: !found,
      });
    } else {
      await MessageReport.updateOne(
        { messageId: message._id, reporterId: access.user.objectId, status: 'open' },
        { $setOnInsert: { messageId: message._id, reporterId: access.user.objectId, status: 'open' } },
        { upsert: true },
      ).exec();
      return NextResponse.json({ success: true, reported: true });
    }
    return NextResponse.json({ success: true, id: message.id, content: message.content, pinned: Boolean(message.pinnedAt), editedAt: message.editedAt?.toISOString() ?? null });
}
