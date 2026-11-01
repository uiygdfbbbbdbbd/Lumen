import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client.js';
import { readJournal, rollbackMigrations, runMigrations } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { ADMIN_URL, urlFor } from '../helpers/env.js';

describe('migrations', () => {
  it('apply from empty, are idempotent, roll back fully, and re-apply; seed is idempotent', async () => {
    const name = `lumen_mig_${randomBytes(4).toString('hex')}`;
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const h = createDb(urlFor(name), { max: 1 });
    try {
      await runMigrations(h);
      await runMigrations(h);
      await seed(h.db);
      await seed(h.db);
      const tiers = await h.sql`SELECT id FROM tiers ORDER BY sort_order`;
      expect(tiers.map((r) => r.id)).toEqual(['unverified', 'verified', 'trusted']);
      const journal = await readJournal();
      const rolled = await rollbackMigrations(h, journal.entries.length);
      expect(rolled).toEqual(journal.entries.map((e) => e.tag).reverse());
      const left = await h.sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
      expect(left[0]!.n).toBe(0);
      await runMigrations(h);
      const users = await h.sql`SELECT count(*)::int AS n FROM users`;
      expect(users[0]!.n).toBe(0);
    } finally {
      await h.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
