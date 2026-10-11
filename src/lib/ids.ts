import { randomBytes } from 'node:crypto';

let lastTimestamp = 0;
let sequence = 0;

export function generatePublicId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError('ID timestamp must be a non-negative safe integer.');
  }

  const timestamp = Math.max(now, lastTimestamp);
  sequence = timestamp === lastTimestamp ? sequence + 1 : 0;
  lastTimestamp = timestamp;

  return `${timestamp.toString(36).padStart(9, '0')}${sequence
    .toString(36)
    .padStart(4, '0')}${randomBytes(8).toString('hex')}`;
}
