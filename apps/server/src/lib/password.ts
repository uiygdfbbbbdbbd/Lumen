import { hash, verify } from '@node-rs/argon2';

/** @node-rs/argon2 Algorithm.Argon2id (a const enum, so inlined here). */
const ARGON2ID = 2;
import { createHash } from 'node:crypto';

/** OWASP 2024 argon2id baseline: m=19 MiB, t=2, p=1. Tests can lower cost via the constructor. */
export interface PasswordParams {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const DEFAULT_PASSWORD_PARAMS: PasswordParams = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export class PasswordHasher {
  constructor(private readonly params: PasswordParams = DEFAULT_PASSWORD_PARAMS) {}

  hash(password: string): Promise<string> {
    return hash(password.normalize('NFKC'), { algorithm: ARGON2ID, ...this.params });
  }

  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password.normalize('NFKC'));
    } catch {
      return false;
    }
  }

  /** True when a stored hash uses weaker parameters than the current policy. */
  needsRehash(hashed: string): boolean {
    const m = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hashed);
    if (!m) return true;
    return Number(m[1]) < this.params.memoryCost || Number(m[2]) < this.params.timeCost;
  }
}

/** A hash to compare against when the user doesn't exist, so timing doesn't reveal account existence. */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$4DkGbtWRHnlyZ3yU6DKcgPwqUOlX3gz7U1ZhKmY2a1s';

export type BreachChecker = (password: string) => Promise<boolean>;

/**
 * HaveIBeenPwned k-anonymity range check. Only the first 5 hex chars of the SHA-1 leave the server.
 * Fails open (returns false) on network errors so an outage never blocks sign-ups.
 */
export function hibpChecker(fetchImpl: typeof fetch = fetch): BreachChecker {
  return async (password) => {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [s, count] = line.trim().split(':');
        return s === suffix && Number(count) > 0;
      });
    } catch {
      return false;
    }
  };
}
