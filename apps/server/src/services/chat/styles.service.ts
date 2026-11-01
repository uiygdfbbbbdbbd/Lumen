import { and, asc, eq } from 'drizzle-orm';
import { complete } from '@lumen/llm';
import { BUILTIN_STYLES, LumenError } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { styles, type UserRow } from '../../db/schema/index.js';
import type { ModelCatalogService } from '../models/catalog.service.js';
import type { ProviderService } from '../providers/provider.service.js';

const MAX_STYLES = 30;

export class StyleService {
  constructor(
    private readonly db: Database,
    private readonly catalog: ModelCatalogService,
    private readonly providers: ProviderService,
  ) {}

  async list(user: UserRow) {
    const custom = await this.db.select().from(styles).where(eq(styles.userId, user.id)).orderBy(asc(styles.name));
    return {
      builtin: Object.entries(BUILTIN_STYLES).map(([id, s]) => ({ id, name: s.name, instructions: s.instructions })),
      custom: custom.map((s) => ({ id: s.id, name: s.name, description: s.description, instructions: s.instructions })),
    };
  }

  async create(user: UserRow, input: { name: string; description: string; instructions: string }) {
    const existing = await this.db.select({ id: styles.id }).from(styles).where(eq(styles.userId, user.id));
    if (existing.length >= MAX_STYLES) throw new LumenError('QUOTA_EXCEEDED', `You can save up to ${MAX_STYLES} styles.`);
    const [s] = await this.db.insert(styles).values({ userId: user.id, ...input }).returning();
    return s!;
  }

  async update(user: UserRow, id: string, input: Partial<{ name: string; description: string; instructions: string }>) {
    const [s] = await this.db.update(styles).set({ ...input, updatedAt: new Date() }).where(and(eq(styles.id, id), eq(styles.userId, user.id))).returning();
    if (!s) throw new LumenError('NOT_FOUND', 'Style not found.');
    return s;
  }

  async delete(user: UserRow, id: string) {
    const res = await this.db.delete(styles).where(and(eq(styles.id, id), eq(styles.userId, user.id))).returning({ id: styles.id });
    if (!res.length) throw new LumenError('NOT_FOUND', 'Style not found.');
  }

  /** Derive writing-style instructions from a sample of the user's own writing. */
  async fromSample(user: UserRow, name: string, sample: string) {
    const model = await this.catalog.defaultFor(user);
    if (!model) throw new LumenError('PROVIDER_UNAVAILABLE', 'No AI models are available.');
    const runtime = await this.providers.runtime(model.provider.id);
    const r = await complete(runtime.adapter, {
      model: model.model.providerModelId,
      maxTokens: 400,
      messages: [
        { role: 'system', content: 'Analyze the writing sample and write concise instructions (max 8 bullet points) that would make an assistant write in the same style: tone, sentence length, vocabulary, formatting, quirks. Output only the instructions.' },
        { role: 'user', content: sample.slice(0, 20_000) },
      ],
    });
    return this.create(user, { name, description: 'Created from a writing sample', instructions: r.text.trim().slice(0, 4000) || 'Match the user’s writing style.' });
  }
}
