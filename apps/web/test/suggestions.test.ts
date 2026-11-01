import { describe, expect, it } from 'vitest';
import { structuredPatch } from 'diff';
import { applyHunks } from '../src/features/artifacts/SuggestionReview.js';

const base = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const proposed = base.replace('line 2\n', 'line two\n').replace('line 18\n', 'line eighteen\n');
const hunks = structuredPatch('a', 'b', base, proposed, '', '', { context: 2 }).hunks;

describe('applyHunks', () => {
  it('splits a suggestion into independent changes', () => {
    expect(hunks).toHaveLength(2);
  });
  it('applies only accepted changes', () => {
    expect(applyHunks(base, hunks, ['accept', 'reject'])).toBe(base.replace('line 2\n', 'line two\n'));
    expect(applyHunks(base, hunks, ['reject', 'accept'])).toBe(base.replace('line 18\n', 'line eighteen\n'));
    expect(applyHunks(base, hunks, ['accept', 'accept'])).toBe(proposed);
    expect(applyHunks(base, hunks, ['reject', 'reject'])).toBe(base);
  });
  it('still applies when the document changed elsewhere, and reports conflicts', () => {
    const edited = base.replace('line 10\n', 'line 10 (edited by user)\n');
    expect(applyHunks(edited, hunks, ['accept', 'accept'])).toBe(proposed.replace('line 10\n', 'line 10 (edited by user)\n'));
    const conflicting = base.replace('line 2\n', 'something else\n').replace('line 1\n', 'other\n').replace('line 3\n', 'x\n');
    expect(applyHunks(conflicting, hunks, ['accept', 'reject'])).toBeNull();
  });
});
