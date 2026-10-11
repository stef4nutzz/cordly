import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { emitRealtime, revokeRealtimeAccess } from '@/lib/realtime/instance';
import { DmConversation } from '@/models/DmConversation';
import { Friendship } from '@/models/Friendship';
import { User } from '@/models/User';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ friendshipId: string }> };

const actionSchema = z.object({ action: z.enum(['accept', 'decline', 'block']) });

export async function PATCH(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to manage friend requests.', 401);

  const { friendshipId } = await context.params;
  try {
    const { action } = actionSchema.parse(await request.json());
    const relation = await Friendship.findOne({
      id: friendshipId,
      status: action === 'block' ? { $in: ['pending', 'accepted'] } : 'pending',
      ...(action === 'block'
        ? { $or: [{ requesterId: user.objectId }, { recipientId: user.objectId }] }
        : { recipientId: user.objectId }),
    }).exec();
    if (!relation) return jsonError('Pending friend request not found.', 404);

    if (action === 'decline') {
      await relation.deleteOne();
      const requester = await User.findById(relation.requesterId).select('id').exec();
      if (requester) emitRealtime(`user:${requester.id}`, 'friendship:updated', {
        status: 'declined',
        user: { id: user.id, username: user.username, tag: user.tag },
      });
      return NextResponse.json({ status: 'declined' });
    }
    if (action === 'block') {
      relation.status = 'blocked';
      await relation.save();
      const otherObjectId = relation.requesterId.equals(user.objectId) ? relation.recipientId : relation.requesterId;
      const otherUser = await User.findById(otherObjectId).select('id').exec();
      if (otherUser) emitRealtime(`user:${otherUser.id}`, 'friendship:updated', {
        status: 'blocked',
        user: { id: user.id, username: user.username, tag: user.tag },
      });
      const participantIds = [relation.requesterId, relation.recipientId];
      const conversation = await DmConversation.findOne({ participantIds: { $all: participantIds } })
        .select('id')
        .exec();
      if (conversation) {
        const participants = await User.find({ _id: { $in: participantIds } }).select('id').lean().exec();
        revokeRealtimeAccess('dm', conversation.id, participants.map((participant) => participant.id));
      }
      return NextResponse.json({ status: 'blocked' });
    }

    relation.status = 'accepted';
    await relation.save();
    const requester = await User.findById(relation.requesterId).select('id').exec();
    if (requester) emitRealtime(`user:${requester.id}`, 'friendship:updated', {
      status: 'accepted',
      user: { id: user.id, username: user.username, tag: user.tag },
    });
    return NextResponse.json({ status: 'accepted' });
  } catch (error) {
    if (error instanceof ZodError) return jsonError('Action must be accept, deny, or block.', 400);
    return jsonError('Friend request could not be updated.', 500);
  }
}
