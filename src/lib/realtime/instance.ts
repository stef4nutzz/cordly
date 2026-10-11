import type { RealtimeServerEvents } from '@/lib/realtime/protocol';

type RealtimeEvent = <K extends keyof RealtimeServerEvents>(
  room: string,
  event: K,
  payload: Parameters<RealtimeServerEvents[K]>[0],
) => void;
type RealtimeAccessKind = 'dm' | 'guild';
type RealtimeAccessRevoker = (kind: RealtimeAccessKind, id: string, userIds: string[]) => void;
type RealtimeGlobal = typeof globalThis & {
  cordlyRealtimeEmit?: RealtimeEvent;
  cordlyRealtimeAccessRevoke?: RealtimeAccessRevoker;
};

export function setRealtimeEmitter(emit: RealtimeEvent | undefined) {
  (globalThis as RealtimeGlobal).cordlyRealtimeEmit = emit;
}

export function setRealtimeAccessRevoker(revoke: RealtimeAccessRevoker | undefined) {
  (globalThis as RealtimeGlobal).cordlyRealtimeAccessRevoke = revoke;
}

export function revokeRealtimeAccess(kind: RealtimeAccessKind, id: string, userIds: string[]) {
  (globalThis as RealtimeGlobal).cordlyRealtimeAccessRevoke?.(kind, id, userIds);
}

export function emitRealtime<K extends keyof RealtimeServerEvents>(
  room: string,
  event: K,
  payload: Parameters<RealtimeServerEvents[K]>[0],
) {
  (globalThis as RealtimeGlobal).cordlyRealtimeEmit?.(room, event, payload);
}
