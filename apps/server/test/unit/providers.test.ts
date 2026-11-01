import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/services/providers/circuit-breaker.js';
import { guessCapabilities } from '../../src/services/providers/provider.service.js';
import { lockReason } from '../../src/services/models/catalog.service.js';

describe('CircuitBreaker', () => {
  it('opens after the threshold, half-opens after cooldown, allows one trial, closes on success', () => {
    let t = 0;
    const cb = new CircuitBreaker(3, 1000, () => t);
    for (let i = 0; i < 2; i++) cb.failure('p');
    expect(cb.state('p')).toBe('closed');
    cb.failure('p');
    expect(cb.state('p')).toBe('open');
    expect(cb.allow('p')).toBe(false);
    t = 1000;
    expect(cb.state('p')).toBe('half_open');
    expect(cb.allow('p')).toBe(true);
    expect(cb.allow('p')).toBe(false); // only one trial
    cb.failure('p'); // trial failed -> open again
    expect(cb.state('p')).toBe('open');
    t = 2000;
    expect(cb.allow('p')).toBe(true);
    cb.success('p');
    expect(cb.state('p')).toBe('closed');
    expect(cb.allow('other')).toBe(true);
  });
});

describe('guessCapabilities', () => {
  it('recognizes common model families', () => {
    expect(guessCapabilities('openai', 'gpt-4o-mini')).toMatchObject({ vision: true, tools: true });
    expect(guessCapabilities('openai', 'o3-mini').reasoning).toBe(true);
    expect(guessCapabilities('openai', 'text-embedding-3-small').tools).toBe(false);
    expect(guessCapabilities('openai', 'dall-e-3').imageGen).toBe(true);
    expect(guessCapabilities('ollama', 'llava:13b').vision).toBe(true);
    expect(guessCapabilities('lmstudio', 'qwen').tools).toBe(false);
  });
});

describe('lockReason', () => {
  const user = { role: 'user' as const, emailVerifiedAt: null, betaTester: false };
  const verified = { ...user, emailVerifiedAt: new Date() };
  it('applies visibility per viewer', () => {
    expect(lockReason({ visibility: 'everyone' }, user)).toBeNull();
    expect(lockReason({ visibility: 'verified' }, user)).toBe('EMAIL_UNVERIFIED');
    expect(lockReason({ visibility: 'verified' }, verified)).toBeNull();
    expect(lockReason({ visibility: 'admins' }, verified)).toBe('ADMINS_ONLY');
    expect(lockReason({ visibility: 'beta' }, verified)).toBe('BETA_ONLY');
    expect(lockReason({ visibility: 'beta' }, { ...verified, betaTester: true })).toBeNull();
    expect(lockReason({ visibility: 'admins' }, { ...user, role: 'admin' })).toBeNull();
    expect(lockReason({ visibility: 'verified' }, { ...user, role: 'moderator' })).toBeNull();
  });
});
