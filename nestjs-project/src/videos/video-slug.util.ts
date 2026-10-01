import { randomBytes } from 'node:crypto';

/** 8 random bytes → 11 base64url chars (64 bits of entropy). */
export function generateVideoSlug(): string {
  return randomBytes(8).toString('base64url');
}
