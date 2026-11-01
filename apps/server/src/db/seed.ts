import { sql } from 'drizzle-orm';
import { DEFAULT_TIERS } from '@lumen/shared';
import type { Database } from './client.js';
import { platformSettings, tiers } from './schema/index.js';
import { DEFAULT_SETTINGS } from '../services/settings/defaults.js';

/**
 * Idempotent: safe to run on every boot. Inserts built-in tiers and default settings
 * without overwriting values an admin has changed.
 */
export async function seed(db: Database): Promise<void> {
  const tierRows = Object.values(DEFAULT_TIERS).map((t, i) => ({
    id: t.id,
    name: t.name,
    features: t.features,
    limits: t.limits,
    builtin: true,
    sortOrder: i,
  }));
  await db.insert(tiers).values(tierRows).onConflictDoNothing();
  // Add any newly introduced feature/limit keys to existing tiers without touching admin edits.
  for (const t of Object.values(DEFAULT_TIERS)) {
    await db.execute(sql`
      UPDATE tiers SET
        features = ${JSON.stringify(t.features)}::jsonb || features,
        limits = ${JSON.stringify(t.limits)}::jsonb || limits
      WHERE id = ${t.id}`);
  }
  const settingRows = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
  await db.insert(platformSettings).values(settingRows).onConflictDoNothing();
}
