import { describe, expect, it } from 'vitest';

import { generatePublicId } from '../lib/ids';

describe('public IDs', () => {
  it('are unique and sort in generation order', () => {
    const timestamp = Date.now() + 10000;
    const ids = [
      generatePublicId(timestamp),
      generatePublicId(timestamp),
      generatePublicId(timestamp + 1),
    ];

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejects invalid timestamps', () => {
    expect(() => generatePublicId(-1)).toThrow(RangeError);
  });
});
