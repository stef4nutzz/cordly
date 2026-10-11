import { describe, expect, it } from 'vitest';

import { allocateUniqueTag, shouldGrantInitialOwner } from '../server/services/account-foundation';

describe('account foundation helpers', () => {
  it('allocates an unused four-digit tag', () => {
    const tag = allocateUniqueTag(new Set(['0042']), () => '0042');

    expect(tag).toBe('0043');
  });

  it('wraps around the tag space and detects exhaustion', () => {
    expect(allocateUniqueTag(new Set(['9999']), () => '9999')).toBe('0000');
    expect(() => allocateUniqueTag(new Set(Array.from({ length: 10000 }, (_, i) =>
      String(i).padStart(4, '0'),
    )), () => '0000')).toThrow('No unique username tag is available');
  });

  it('only grants bootstrap Owner to the first matching registration', () => {
    expect(shouldGrantInitialOwner('OWNER@example.com', 'owner@example.com', false)).toBe(true);
    expect(shouldGrantInitialOwner('owner@example.com', 'owner@example.com', true)).toBe(false);
    expect(shouldGrantInitialOwner('other@example.com', 'owner@example.com', false)).toBe(false);
    expect(shouldGrantInitialOwner('owner@example.com', undefined, false)).toBe(false);
  });
});
