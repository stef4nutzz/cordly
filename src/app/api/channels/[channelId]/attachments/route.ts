import { NextRequest, NextResponse } from 'next/server';

import { jsonError } from '@/lib/api';
import { connectToDatabase } from '@/lib/db';
import { env } from '@/lib/env';
import { Channel } from '@/models/Channel';
import { ChannelAttachment } from '@/models/ChannelAttachment';
import { GuildMember } from '@/models/GuildMember';
import { getAuthenticatedUser } from '@/server/services/session-service';

export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ channelId: string }> };
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
  if (!user) return jsonError('Sign in to upload channel files.', 401);
  const { channelId } = await context.params;
  const channel = await Channel.findOne({ id: channelId, deletedAt: null }).select('_id guildId').exec();
  if (!channel) return jsonError('Channel not found.', 404);
  if (!(await GuildMember.exists({ guildId: channel.guildId, userId: user.objectId }))) {
    return jsonError('You are not a member of this community.', 403);
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return jsonError('Choose a file to upload.', 400);
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size < 1 || file.size > maxBytes) return jsonError(`Files must be smaller than ${env.MAX_UPLOAD_MB} MB.`, 413);
  if (!allowedTypes.has(file.type)) return jsonError('This file type is not supported.', 415);
  const data = Buffer.from(await file.arrayBuffer());
  if (!hasValidSignature(data, file.type)) return jsonError('The file content does not match its declared type.', 415);
  const attachment = await ChannelAttachment.create({
    channelId: channel._id,
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
