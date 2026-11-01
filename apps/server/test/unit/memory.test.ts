import { describe, expect, it } from 'vitest';
import { detectSecret } from '../../src/lib/sensitive.js';
import { cosine, guessCategory, isDuplicate, parseMemoryExport } from '../../src/services/memory/memory.service.js';

describe('detectSecret', () => {
  it.each([
    ['-----BEGIN RSA PRIVATE KEY-----', 'a private key'],
    ['key sk-live-abcdefghijklmnop1234', 'an API key'],
    ['AKIAABCDEFGHIJKLMNOP', 'a cloud access key'],
    ['ghp_' + 'a'.repeat(36), 'an access token'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', 'an access token'],
    ['my password is hunter2', 'a password'],
    ['PIN: 1234', 'a PIN'],
    ['api key = abc123def456', 'a secret key'],
    ['SSN 123-45-6789', 'a government ID number'],
    ['IBAN GB82 WEST 1234 5698 7654 32', 'a bank account number'],
    ['card 4242 4242 4242 4242', 'a payment card number'],
  ])('flags %s', (text, what) => {
    expect(detectSecret(text)).toBe(what);
  });
  it.each(['Prefers metric units.', 'My secret is that I love cake', 'Ran a 10k in 52:30', 'Phone extension 4421', 'Order number 1234567890123 arrived', 'The token is shared with the team'])('allows %s', (text) => {
    expect(detectSecret(text)).toBeNull();
  });
});

describe('memory import parsing', () => {
  it('reads bullet lists with dates and numbering, skipping headings and repeats', () => {
    expect(parseMemoryExport('## Memories\n- [2024-05-01 10:00] Likes tea\n2) Has a dog named Rex\n\n• Likes tea\nHere is what I know')).toEqual([
      { content: 'Likes tea', category: 'preferences' },
      { content: 'Has a dog named Rex', category: 'profile' },
    ]);
  });
  it('reads JSON arrays and objects in common shapes', () => {
    expect(parseMemoryExport('["Is a nurse", {"text":"Planning a trip to Peru by next week"}, {"memory":"x"}, 5]')).toEqual([
      { content: 'Is a nurse', category: 'profile' },
      { content: 'Planning a trip to Peru by next week', category: 'tasks' },
    ]);
    expect(parseMemoryExport('{"items":[{"content":"Uses Vim","category":"preferences"}]}')).toEqual([{ content: 'Uses Vim', category: 'preferences' }]);
    expect(parseMemoryExport('{not json but text}')).toEqual([{ content: '{not json but text}', category: 'other' }]);
  });
  it('guesses categories', () => {
    expect(guessCategory('My wife Ana is a chef')).toBe('people');
    expect(guessCategory('Working on a startup called Bloom')).toBe('projects');
    expect(guessCategory('Hates long emails')).toBe('preferences');
    expect(guessCategory('Blue')).toBe('other');
  });
});

describe('duplicate detection', () => {
  const m = (content: string, embedding: number[] | null = null) => ({ content, embedding, embeddingModel: embedding ? 'e' : null });
  it('matches identical, near-identical and same-meaning (by embedding) memories', () => {
    expect(isDuplicate(m('Prefers metric units.'), m('prefers METRIC units'))).toBe(true);
    expect(isDuplicate(m('Lives in Lisbon with two cats and a dog'), m('Lives in Lisbon with two cats and dog'))).toBe(true);
    expect(isDuplicate(m('Likes tea', [1, 0, 0]), m('Enjoys tea', [0.99, 0.05, 0]))).toBe(true);
    expect(isDuplicate(m('Likes tea'), m('Likes coffee'))).toBe(false);
    expect(isDuplicate(m('a', [1, 0]), { content: 'b', embedding: [1, 0], embeddingModel: 'other' })).toBe(false);
  });
  it('computes cosine similarity safely', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });
});
