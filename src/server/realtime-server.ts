import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import { Server, type Socket } from 'socket.io';

import { connectToDatabase } from '@/lib/db';
import { setRealtimeAccessRevoker, setRealtimeEmitter } from '@/lib/realtime/instance';
import type { RealtimeClientEvents, RealtimeRoom, RealtimeServerEvents } from '@/lib/realtime/protocol';
import { Channel } from '@/models/Channel';
import { DmConversation } from '@/models/DmConversation';
import { Friendship } from '@/models/Friendship';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { publishPresence } from '@/server/services/realtime-presence';
import { authenticateSessionToken } from '@/server/services/session-service';
import { logger } from '@/lib/logger';

type Account = NonNullable<Awaited<ReturnType<typeof authenticateSessionToken>>>;
type SocketData = { account: Account; sessionId: string; lastTypingAt: number; channelGuilds: Map<string, string> };
type RealtimeSocket = Socket<RealtimeClientEvents, RealtimeServerEvents, Record<string, never>, SocketData>;

const roomIdPattern = /^[a-z0-9]{13}[a-f0-9]{16}$/;
const activeConnections = new Map<string, number>();
const socketsByUser = new Map<string, Set<RealtimeSocket>>();

function getCookie(request: IncomingMessage, name: string) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}

function roomName(room: RealtimeRoom) {
  return `${room.type}:${room.id}`;
}

function isRealtimeRoom(input: unknown): input is RealtimeRoom {
  if (typeof input !== 'object' || input === null) return false;
  const room = input as Record<string, unknown>;
  return (room.type === 'channel' || room.type === 'dm')
    && typeof room.id === 'string'
    && roomIdPattern.test(room.id);
}

async function authorizeRoom(account: Account, room: RealtimeRoom) {
  if (room.type === 'channel') {
    const channel = await Channel.findOne({ id: room.id, deletedAt: null }).select('_id guildId').exec();
    if (!channel) return false;
    const membership = await GuildMember.exists({ guildId: channel.guildId, userId: account.objectId });
    if (!membership) return false;
    const guild = await Guild.findById(channel.guildId).select('id').exec();
    return guild ? { guildId: guild.id } : false;
  }

  const conversation = await DmConversation.findOne({
    id: room.id,
    participantIds: account.objectId,
  }).select('_id participantIds').exec();
  if (!conversation) return false;
  const otherId = conversation.participantIds.find(
    (participantId: import('mongoose').Types.ObjectId) => !participantId.equals(account.objectId),
  );
  if (!otherId) return false;
  const friendship = await Friendship.exists({
    status: 'accepted',
    $or: [
      { requesterId: account.objectId, recipientId: otherId },
      { requesterId: otherId, recipientId: account.objectId },
    ],
  });
  return friendship ? true : false;
}

function isSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers['x-forwarded-host']?.toString().split(',')[0].trim()
    ?? request.headers.host;
  const forwardedProtocol = request.headers['x-forwarded-proto']?.toString().split(',')[0].trim();
  const protocol = forwardedProtocol ?? (request.socket instanceof TLSSocket ? 'https' : 'http');
  if (!host) return false;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host && parsedOrigin.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export function attachRealtimeServer(httpServer: import('node:http').Server) {
  const io = new Server<RealtimeClientEvents, RealtimeServerEvents, Record<string, never>, SocketData>(httpServer, {
    cors: { origin: true, credentials: true },
    allowRequest: (request, callback) => callback(null, isSameOrigin(request)),
    serveClient: false,
  });
  setRealtimeEmitter(<K extends keyof RealtimeServerEvents>(
    room: string,
    event: K,
    payload: Parameters<RealtimeServerEvents[K]>[0],
  ) => {
    const roomEmitter = io.to(room);
    const emit: (
      event: keyof RealtimeServerEvents,
      payload: Parameters<RealtimeServerEvents[keyof RealtimeServerEvents]>[0],
    ) => void = roomEmitter.emit.bind(roomEmitter) as (
      event: keyof RealtimeServerEvents,
      payload: Parameters<RealtimeServerEvents[keyof RealtimeServerEvents]>[0],
    ) => void;
    emit(event, payload);
  });
  setRealtimeAccessRevoker((kind, id, userIds) => {
    for (const userId of userIds) {
      for (const socket of socketsByUser.get(userId) ?? []) {
        if (kind === 'dm') {
          void socket.leave(`dm:${id}`);
          continue;
        }
        void socket.leave(`guild:${id}`);
        for (const [channelId, guildId] of socket.data.channelGuilds) {
          if (guildId === id) {
            void socket.leave(`channel:${channelId}`);
            socket.data.channelGuilds.delete(channelId);
          }
        }
      }
    }
  });

  io.use(async (socket, next) => {
    try {
      await connectToDatabase();
      const token = getCookie(socket.request, 'cordly_session');
      const account = token ? await authenticateSessionToken(token) : null;
      if (!account) {
        next(new Error('Authentication required.'));
        return;
      }
      socket.data.account = account;
      socket.data.sessionId = account.sessionId;
      socket.data.lastTypingAt = 0;
      socket.data.channelGuilds = new Map();
      next();
    } catch (error) {
      logger.error({ err: error }, 'Socket.IO authentication failed.');
      next(new Error('Socket authentication failed.'));
    }
  });

  io.on('connection', (socket: RealtimeSocket) => {
    const account = socket.data.account;
    const userSockets = socketsByUser.get(account.id) ?? new Set<RealtimeSocket>();
    userSockets.add(socket);
    socketsByUser.set(account.id, userSockets);
    socket.join(`user:${account.id}`);
    socket.join(`session:${socket.data.sessionId}`);
    const connectionCount = activeConnections.get(account.id) ?? 0;
    activeConnections.set(account.id, connectionCount + 1);
    if (connectionCount === 0) {
      void publishPresence(account.objectId.toString(), account.status !== 'offline', account.status)
        .catch((error: unknown) => logger.error({ err: error, userId: account.id }, 'Could not publish connected presence.'));
    }

    socket.on('room:join', async (room) => {
      if (!isRealtimeRoom(room)) {
        socket.emit('room:error', 'That conversation could not be joined.');
        return;
      }
      try {
        const authorized = await authorizeRoom(account, room);
        if (!authorized) {
          socket.emit('room:error', 'You no longer have access to that conversation.');
          return;
        }
        await socket.join(roomName(room));
        if (room.type === 'channel' && typeof authorized === 'object') {
          socket.data.channelGuilds.set(room.id, authorized.guildId);
          await socket.join(`guild:${authorized.guildId}`);
        }
      } catch (error) {
        logger.error({ err: error, userId: account.id, roomType: room.type }, 'Could not authorize Socket.IO room.');
        socket.emit('room:error', 'Could not join that conversation.');
      }
    });

    socket.on('room:leave', (room) => {
      if (isRealtimeRoom(room)) {
        void socket.leave(roomName(room));
        if (room.type === 'channel') socket.data.channelGuilds.delete(room.id);
      }
    });

    socket.on('typing:set', (input) => {
      if (!isRealtimeRoom(input) || typeof input.active !== 'boolean') return;
      const room = roomName(input);
      if (!socket.rooms.has(room)) return;
      const now = Date.now();
      if (input.active && now - socket.data.lastTypingAt < 700) return;
      socket.data.lastTypingAt = now;
      socket.to(room).emit('typing:updated', {
        ...input,
        userId: account.id,
        username: account.username,
      });
    });

    socket.on('disconnect', () => {
      userSockets.delete(socket);
      if (!userSockets.size) socketsByUser.delete(account.id);
      for (const room of socket.rooms) {
        if (room.startsWith('channel:') || room.startsWith('dm:')) {
          socket.to(room).emit('typing:updated', {
            type: room.startsWith('channel:') ? 'channel' : 'dm',
            id: room.slice(room.indexOf(':') + 1),
            userId: account.id,
            username: account.username,
            active: false,
          });
        }
      }
      const remaining = Math.max((activeConnections.get(account.id) ?? 1) - 1, 0);
      if (remaining === 0) {
        activeConnections.delete(account.id);
        void publishPresence(account.objectId.toString(), false, account.status)
          .catch((error: unknown) => logger.error({ err: error, userId: account.id }, 'Could not publish disconnected presence.'));
      } else {
        activeConnections.set(account.id, remaining);
      }
    });
  });

  return io;
}
