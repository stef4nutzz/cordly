import { describe, expect, it } from 'vitest';
import { matchesMessageSearch } from '../lib/message-search';

const message = {
  content: 'Hello @Mira https://cordly.example',
  createdAt: '2026-04-12T12:00:00.000Z',
  author: { username: 'Ari', tag: '1234' },
  attachments: [{ contentType: 'image/png' }],
};
const me = { username: 'Mira', tag: '5678' };

describe('matchesMessageSearch', () => {
  it('matches message text and all supported search filters', () => {
    expect(matchesMessageSearch(message, 'hello from:Ari#1234 in:general has:link has:image mentions:me after:2026-04-11 before:2026-04-13', 'general', me)).toBe(true);
  });

  it('rejects filters that do not match the message', () => {
    expect(matchesMessageSearch(message, 'from:someone', 'general', me)).toBe(false);
    expect(matchesMessageSearch(message, 'has:file', 'general', me)).toBe(true);
    expect(matchesMessageSearch(message, 'mentions:everyone', 'general', me)).toBe(false);
    expect(matchesMessageSearch(message, 'after:invalid-date', 'general', me)).toBe(false);
  });

  it('supports quoted text and channel filters', () => {
    expect(matchesMessageSearch(message, '"hello @mira" in:gen', 'general', me)).toBe(true);
  });
});
