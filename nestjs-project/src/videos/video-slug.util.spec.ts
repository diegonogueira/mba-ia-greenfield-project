import { generateVideoSlug } from './video-slug.util';

describe('generateVideoSlug', () => {
  it('returns 11 base64url characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateVideoSlug()).toMatch(/^[A-Za-z0-9_-]{11}$/);
    }
  });

  it('returns different values across calls', () => {
    const slugs = new Set(Array.from({ length: 1000 }, generateVideoSlug));
    expect(slugs.size).toBe(1000);
  });
});
