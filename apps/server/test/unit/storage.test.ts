import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsStorage } from '../../src/services/storage/storage.js';

async function readAll(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe('FsStorage', () => {
  it('replaces objects atomically: an open read keeps seeing the old bytes, sized consistently', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lumen-storage-'));
    try {
      const fs = new FsStorage(root);
      const big = Buffer.alloc(2 * 1024 * 1024, 7);
      await fs.put('files/u/a', big, 'image/png');
      const obj = (await fs.get('files/u/a'))!;
      await fs.put('files/u/a', Buffer.from('small'), 'image/png');
      const old = await readAll(obj.body);
      expect(old.length).toBe(obj.size);
      expect(old.equals(big)).toBe(true);
      const now = (await fs.get('files/u/a'))!;
      expect((await readAll(now.body)).toString()).toBe('small');
      expect(now.size).toBe(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
