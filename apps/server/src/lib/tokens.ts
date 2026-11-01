import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Human-friendly code (e.g. recovery codes): 10 chars, grouped, no ambiguous characters. */
export function randomCode(length = 10): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export class TokenHasher {
  constructor(private readonly secret: string) {}

  /** Keyed hash so a database leak alone can't be used to forge or look up tokens. */
  hash(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  equals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}
