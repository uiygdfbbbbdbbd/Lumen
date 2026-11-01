import { eq } from 'drizzle-orm';
import { LumenError } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { platformSettings } from '../../db/schema/index.js';
import { DEFAULT_SETTINGS, settingSchemas, type AllSettings, type SettingKey, type SettingValue } from './defaults.js';

/**
 * Typed platform settings stored as JSON rows. Values are validated on read and write;
 * invalid stored values fall back to defaults instead of crashing requests.
 * A short in-process cache keeps hot paths (every request checks maintenance mode) cheap.
 */
export class SettingsService {
  private cache: { at: number; value: AllSettings } | null = null;

  constructor(
    private readonly db: Database,
    private readonly ttlMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  async all(): Promise<AllSettings> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.value;
    const rows = await this.db.select().from(platformSettings);
    const out = structuredClone(DEFAULT_SETTINGS) as AllSettings;
    for (const row of rows) {
      const key = row.key as SettingKey;
      const schema = settingSchemas[key];
      if (!schema) continue;
      const merged = typeof row.value === 'object' && row.value && !Array.isArray(row.value) && key !== 'features'
        ? { ...(DEFAULT_SETTINGS[key] as object), ...(row.value as object) }
        : row.value;
      const parsed = schema.safeParse(merged);
      if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
    }
    this.cache = { at: this.now(), value: out };
    return out;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return (await this.all())[key];
  }

  async set<K extends SettingKey>(key: K, value: unknown, actorId: string | null): Promise<SettingValue<K>> {
    const schema = settingSchemas[key];
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new LumenError('VALIDATION_FAILED', `Invalid value for setting "${key}"`, { details: parsed.error.issues });
    }
    await this.db
      .insert(platformSettings)
      .values({ key, value: parsed.data, updatedBy: actorId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: parsed.data, updatedAt: new Date(), updatedBy: actorId } });
    this.invalidate();
    return parsed.data as SettingValue<K>;
  }

  async patch<K extends SettingKey>(key: K, partial: Partial<SettingValue<K>>, actorId: string | null) {
    const current = await this.get(key);
    return this.set(key, { ...(current as object), ...(partial as object) }, actorId);
  }

  invalidate() {
    this.cache = null;
  }

  async raw(key: SettingKey) {
    const [row] = await this.db.select().from(platformSettings).where(eq(platformSettings.key, key));
    return row?.value;
  }
}
