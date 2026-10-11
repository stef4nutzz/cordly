import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z, ZodError } from 'zod';

import { isDuplicateKeyError, jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { connectToDatabase } from '@/lib/db';
import { emitRealtime } from '@/lib/realtime/instance';
import { DmConversation } from '@/models/DmConversation';
import { DirectMessage } from '@/models/DirectMessage';
import { Friendship } from '@/models/Friendship';
import { User } from '@/models/User';
import { UserSettings } from '@/models/UserSettings';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

const openConversationSchema = z.object({ recipientId: z.string().min(1).max(40) }).strict();

function conversationKey(first: Types.ObjectId, second: Types.ObjectId) {
  return [first.toString(), second.toString()].sort().join(':');
}

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view direct messages.', 401);

  const conversations = await DmConversation.find({ participantIds: user.objectId })
    .sort({ updatedAt: -1 })
    .populate('participantIds', 'id username tag status avatarVersion')
    .exec();
  const latestMessages = conversations.length
    ? await DirectMessage.aggregate<{
        _id: Types.ObjectId;
        id: string;
        content: string;
        createdAt: Date;
        authorId: Types.ObjectId;
      }>([
        {
          $match: {
            conversationId: { $in: conversations.map((conversation) => conversation._id) },
            deletedAt: null,
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$conversationId',
            id: { $first: '$id' },
            content: { $first: '$content' },
            createdAt: { $first: '$createdAt' },
            authorId: { $first: '$authorId' },
          },
        },
      ])
    : [];
  const latestByConversation = new Map(latestMessages.map((message) => [message._id.toString(), message]));
  const messageAuthors = latestMessages.length
    ? await User.find({ _id: { $in: latestMessages.map((message) => message.authorId) } }).select('_id id').lean().exec()
    : [];
  const authorIds = new Map(messageAuthors.map((author) => [String(author._id), author.id]));
  const entries = conversations.map((conversation) => {
    const participants = conversation.participantIds as unknown as Array<{
      _id: Types.ObjectId;
      id: string;
      username: string;
      tag: string;
      status: string;
      avatarVersion: string | null;
    }>;
    const other = participants.find((participant) => !participant._id.equals(user.objectId));
    if (!other) return null;
    const latest = latestByConversation.get(conversation._id.toString());
    return {
      id: conversation.id,
      updatedAt: conversation.updatedAt.toISOString(),
      lastMessage: latest ? {
        id: latest.id,
        content: latest.content,
        createdAt: latest.createdAt.toISOString(),
        authorId: authorIds.get(latest.authorId.toString()) ?? '',
      } : null,
      user: {
        id: other.id,
        username: other.username,
        tag: other.tag,
        status: other.status,
        avatarUrl: publicAvatarUrl(other.id, other.avatarVersion),
      },
    };
  });
  return NextResponse.json({ conversations: entries.filter((entry) => entry !== null) });
}

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to start a direct message.', 401);

  try {
    const { recipientId } = openConversationSchema.parse(await request.json());
    const recipient = await User.findOne({ id: recipientId, deletedAt: null, disabledAt: null })
      .select('_id id username tag status avatarVersion')
      .exec();
    if (!recipient) return jsonError('That user could not be found.', 404);
    if (recipient._id.equals(user.objectId)) return jsonError('You cannot start a conversation with yourself.', 400);

    const friendship = await Friendship.findOne({
      status: 'accepted',
      $or: [
        { requesterId: user.objectId, recipientId: recipient._id },
        { requesterId: recipient._id, recipientId: user.objectId },
      ],
    }).select('_id').exec();
    if (!friendship) return jsonError('You can start direct messages with accepted friends.', 403);

    const recipientSettings = await UserSettings.findOne({ userId: recipient._id })
      .select('preferences.privacy.directMessages')
      .lean<{ preferences?: { privacy?: { directMessages?: 'everyone' | 'friends' | 'nobody' } } }>()
      .exec();
    if (recipientSettings?.preferences?.privacy?.directMessages === 'nobody') {
      return jsonError('This user is not accepting direct messages.', 403);
    }

    const key = conversationKey(user.objectId, recipient._id);
    let conversation = await DmConversation.findOne({ key }).exec();
    if (!conversation) {
      try {
        conversation = await DmConversation.create({
          participantIds: [user.objectId, recipient._id],
          key,
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        conversation = await DmConversation.findOne({ key }).exec();
        if (!conversation) throw error;
      }
    }
    const openedAt = conversation.updatedAt.toISOString();
    emitRealtime(`user:${user.id}`, 'dm:conversation:created', {
      id: conversation.id,
      updatedAt: openedAt,
      lastMessage: null,
      user: {
        id: recipient.id,
        username: recipient.username,
        tag: recipient.tag,
        status: recipient.status,
        avatarUrl: publicAvatarUrl(recipient.id, recipient.avatarVersion),
      },
    });
    emitRealtime(`user:${recipient.id}`, 'dm:conversation:created', {
      id: conversation.id,
      updatedAt: openedAt,
      lastMessage: null,
      user: {
        id: user.id,
        username: user.username,
        tag: user.tag,
        status: user.status,
        avatarUrl: user.avatarUrl,
      },
    });
    return NextResponse.json({ id: conversation.id }, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('A valid friend is required to start a direct message.', 400);
    return jsonError('The direct message could not be opened.', 500);
  }
}
