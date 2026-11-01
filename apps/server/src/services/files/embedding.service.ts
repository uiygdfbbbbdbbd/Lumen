import { estimateTokens } from '@lumen/llm';
import { LumenError } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { usageEvents } from '../../db/schema/index.js';
import type { ModelCatalogService, ResolvedModel } from '../models/catalog.service.js';
import type { ProviderService } from '../providers/provider.service.js';
import type { SettingsService } from '../settings/settings.service.js';

const BATCH = 64;

/** Embeds text with the admin-configured embedding model (settings.rag.embeddingModelId). */
export class EmbeddingService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly catalog: ModelCatalogService,
    private readonly providers: ProviderService,
  ) {}

  /** The configured model, resolved as a system caller (embedding models need not be visible to users). */
  async model(): Promise<ResolvedModel | null> {
    const { embeddingModelId } = await this.settings.get('rag');
    if (!embeddingModelId) return null;
    try {
      return await this.catalog.resolve(embeddingModelId, { role: 'super_admin', emailVerifiedAt: new Date(), betaTester: true });
    } catch {
      return null;
    }
  }

  async embedMany(texts: string[], userId: string | null): Promise<{ vectors: number[][]; model: string } | null> {
    const m = await this.model();
    if (!m) return null;
    const runtime = await this.providers.runtime(m.provider.id);
    const vectors: number[][] = [];
    let tokens = 0;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const r = await runtime.adapter.embed(m.model.providerModelId, batch, AbortSignal.timeout(60_000));
      if (r.vectors.length !== batch.length) throw new LumenError('PROVIDER_ERROR', 'Embedding provider returned the wrong number of vectors.');
      vectors.push(...r.vectors);
      tokens += r.inputTokens || batch.reduce((s, t) => s + estimateTokens(t), 0);
    }
    await this.db.insert(usageEvents).values({ userId, source: 'embedding', modelId: m.model.id, providerId: m.provider.id, providerKeyId: runtime.keyId, inputTokens: tokens, status: 'ok' });
    await this.providers.reportSuccess(m.provider.id, runtime.keyId, 0);
    return { vectors, model: m.model.id };
  }

  async embedOne(text: string, userId: string | null): Promise<{ vector: number[]; model: string } | null> {
    const r = await this.embedMany([text], userId);
    return r ? { vector: r.vectors[0]!, model: r.model } : null;
  }
}
