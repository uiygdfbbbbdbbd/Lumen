import { describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES as SHARED } from '@lumen/shared';
import { ARTIFACT_TYPES as DB } from '../../src/db/schema/index.js';

describe('artifact types', () => {
  it('the database enum matches the shared list', () => {
    expect([...DB]).toEqual([...SHARED]);
  });
});
