import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { isDuplicateKeyError, jsonError } from '@/lib/api';
import { publicAvatarUrl } from '@/lib/avatar';
import { connectToDatabase } from '@/lib/db';
import { emitRealtime } from '@/lib/realtime/instance';
import { Friendship } from '@/models/Friendship';
import { GuildMember } from '@/models/GuildMember';
import { User } from '@/models/User';
import { UserSettings } from '@/models/UserSettings';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

const friendIdentifierSchema = z.string().trim().regex(/^.{2,32}#\d{4}$/);

export async function GET(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view friends.', 401);

  const relations = await Friendship.find({
    status: { $in: ['accepted', 'pending'] },
    $or: [{ requesterId: user.objectId }, { recipientId: user.objectId }],
  })
    .sort({ updatedAt: -1 })
    .populate('requesterId', 'id username tag status avatarVersion')
    .populate('recipientId', 'id username tag status avatarVersion')
    .exec();

  const friends = relations.map((relation) => {
    const requester = relation.requesterId as unknown as {
      id: string;
      username: string;
      tag: string;
      status: string;
      avatarVersion: string | null;
    };
    const recipient = relation.recipientId as unknown as {
      id: string;
      username: string;
      tag: string;
      status: string;
      avatarVersion: string | null;
    };
    const incoming = relation.recipientId._id.equals(user.objectId);
    const other = incoming ? requester : recipient;
    return {
      id: relation.id,
      status: relation.status,
      incoming,
      user: {
        id: other.id,
        username: other.username,
        tag: other.tag,
        status: other.status,
        avatarUrl: publicAvatarUrl(other.id, other.avatarVersion),
      },
    };
  });
  return NextResponse.json({ friends });
}

export async function POST(request: NextRequest) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to add a friend.', 401);

  try {
    const body: unknown = await request.json();
    const identifier = friendIdentifierSchema.parse(
      typeof body === 'object' && body !== null && 'identifier' in body ? body.identifier : '',
    );
    const [, username, tag] = identifier.match(/^(.+)#(\d{4})$/) ?? [];
    const recipient = await User.findOne({
      usernameLower: username.toLowerCase(),
      tag,
      deletedAt: null,
      disabledAt: null,
    }).exec();
    if (!recipient) return jsonError('No account matches that username and tag.', 404);
    if (recipient._id.equals(user.objectId)) {
      return jsonError('You cannot send a friend request to yourself.', 400);
    }

    const existing = await Friendship.findOne({
      $or: [
        { requesterId: user.objectId, recipientId: recipient._id },
        { requesterId: recipient._id, recipientId: user.objectId },
      ],
    }).exec();
    if (existing?.status === 'accepted') return jsonError('You are already friends.', 409);
    if (existing?.status === 'blocked') return jsonError('This friend relationship is blocked.', 403);
    if (existing?.status === 'pending') {
      if (existing.recipientId.equals(user.objectId)) {
        existing.status = 'accepted';
        await existing.save();
        emitRealtime(`user:${recipient.id}`, 'friendship:updated', {
          status: 'accepted',
          user: { id: user.id, username: user.username, tag: user.tag },
        });
        return NextResponse.json({ status: 'accepted' });
      }
      return jsonError('A friend request is already pending.', 409);
    }

    const recipientSettings = await UserSettings.findOne({ userId: recipient._id })
      .select('preferences.privacy.friendRequests')
      .exec();
    const requestPolicy = recipientSettings?.preferences?.privacy?.friendRequests ?? 'everyone';
    if (requestPolicy === 'nobody') {
      return jsonError('This user is not accepting friend requests.', 403);
    }
    if (requestPolicy === 'mutuals') {
      const senderCommunities = await GuildMember.find({ userId: user.objectId }).distinct('guildId').exec();
      const mutualCommunity = senderCommunities.length > 0
        ? await GuildMember.exists({ userId: recipient._id, guildId: { $in: senderCommunities } })
        : null;
      if (!mutualCommunity) return jsonError('You need a mutual community to send this friend request.', 403);
    }

    await Friendship.create({
      requesterId: user.objectId,
      recipientId: recipient._id,
      status: 'pending',
    });
    emitRealtime(`user:${recipient.id}`, 'friendship:updated', {
      status: 'pending',
      user: { id: user.id, username: user.username, tag: user.tag },
    });
    return NextResponse.json({ status: 'pending' }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Use the format username#1234.', 400);
    if (isDuplicateKeyError(error)) return jsonError('A friend request already exists.', 409);
    return jsonError('Friend request could not be sent.', 500);
  }
}
