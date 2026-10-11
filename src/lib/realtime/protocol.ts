export type RealtimeRoom = { type: 'channel' | 'dm'; id: string };

export type RealtimeMessage = {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string; tag: string; avatarUrl: string | null };
  attachments: Array<{ id: string; filename: string; contentType: string; size: number; url: string }>;
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  pinned: boolean;
  editedAt: string | null;
  replyToId: string | null;
};

export interface RealtimeClientEvents {
  'room:join': (room: RealtimeRoom) => void;
  'room:leave': (room: RealtimeRoom) => void;
  'typing:set': (input: RealtimeRoom & { active: boolean }) => void;
}

export interface RealtimeServerEvents {
  'message:created': (message: RealtimeMessage) => void;
  'message:updated': (update: {
    id: string;
    action: 'edit' | 'pin' | 'react';
    content?: string;
    pinned?: boolean;
    editedAt?: string | null;
    emoji?: string;
    userId?: string;
    added?: boolean;
  }) => void;
  'message:deleted': (update: { id: string }) => void;
  'dm:conversation:created': (conversation: {
    id: string;
    updatedAt: string;
    lastMessage: null;
    user: { id: string; username: string; tag: string; status: 'online' | 'idle' | 'dnd' | 'offline'; avatarUrl: string | null };
  }) => void;
  'dm:message:created': (update: { conversationId: string; message: RealtimeMessage }) => void;
  'typing:updated': (update: RealtimeRoom & { userId: string; username: string; active: boolean }) => void;
  'presence:updated': (update: { userId: string; status: 'online' | 'idle' | 'dnd' | 'offline'; online: boolean }) => void;
  'friendship:updated': (update: {
    status: 'pending' | 'accepted' | 'declined' | 'blocked';
    user: { id: string; username: string; tag: string };
  }) => void;
  'session:revoked': (reason: string | null) => void;
  'room:error': (message: string) => void;
}
