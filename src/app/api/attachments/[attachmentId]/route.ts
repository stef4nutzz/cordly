import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { ChannelAttachment } from '@/models/ChannelAttachment';
import { Channel } from '@/models/Channel';
import { DmConversation } from '@/models/DmConversation';
import { Friendship } from '@/models/Friendship';
import { GuildMember } from '@/models/GuildMember';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  await connectToDatabase();
  const user = await getAuthenticatedUser(request);
  if (!user) return jsonError('Sign in to view this attachment.', 401);
  const { attachmentId } = await context.params;
  const attachment = await ChannelAttachment.findOne({ id: attachmentId })
    .select('+data')
    .exec();
  if (!attachment) return jsonError('Attachment not found.', 404);

  let hasAccess = false;
  
  const channel = await Channel.findById(attachment.channelId).select('guildId').exec();
  if (channel) {
    hasAccess = Boolean(await GuildMember.exists({ guildId: channel.guildId, userId: user.objectId }));
  } else {
    const conversation = await DmConversation.findById(attachment.channelId)
      .select('participantIds')
      .exec();
    if (conversation) {
      const participantIds = conversation.participantIds as Types.ObjectId[];
      const otherId = participantIds.find((participantId) => !participantId.equals(user.objectId));
      if (participantIds.some((participantId) => participantId.equals(user.objectId)) && otherId) {
        hasAccess = Boolean(await Friendship.exists({
          status: 'accepted',
          $or: [
            { requesterId: user.objectId, recipientId: otherId },
            { requesterId: otherId, recipientId: user.objectId },
          ],
        }));
      }
    }
  }
  
  if (!hasAccess) {
    return jsonError('You cannot view this attachment.', 403);
  }
  
  return new NextResponse(new Uint8Array(attachment.data), {
    headers: {
      'Content-Type': attachment.contentType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `inline; filename="${attachment.filename.replace(/["\\]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
