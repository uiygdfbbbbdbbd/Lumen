import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { ASPECT_RATIOS, LlmError, type AspectRatio } from '@lumen/llm';
import { LumenError, type Entitlements } from '@lumen/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { generatedImages, usageEvents, type GeneratedImageRow, type UserRow } from '../../db/schema/index.js';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { FileService } from '../files/file.service.js';
import { isImageModel, type ModelCatalogService, type ResolvedModel } from '../models/catalog.service.js';
import type { ProviderService } from '../providers/provider.service.js';
import type { SettingsService } from '../settings/settings.service.js';

export function serializeImage(r: GeneratedImageRow) {
  return {
    id: r.id,
    fileId: r.fileId,
    url: `/api/files/${r.fileId}/content`,
    prompt: r.prompt,
    revisedPrompt: r.revisedPrompt,
    aspectRatio: r.aspectRatio,
    modelName: r.modelName,
    seed: r.seed,
    variationOf: r.variationOf,
    conversationId: r.conversationId,
    createdAt: r.createdAt.toISOString(),
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';

export interface GenerateInput {
  prompt: string;
  aspectRatio?: AspectRatio;
  n?: number;
  modelId?: string;
  negativePrompt?: string;
  seed?: number;
  variationOf?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}

export class ImageService {
  constructor(
    private readonly db: Database,
    private readonly catalog: ModelCatalogService,
    private readonly providers: ProviderService,
    private readonly entitlements: EntitlementService,
    private readonly files: FileService,
    private readonly settings: SettingsService,
    private readonly log: Logger,
  ) {}

  /** Image models this user can use (for pickers). */
  async models(user: UserRow) {
    return (await this.catalog.listForUser(user, null as never)).filter((m) => isImageModel(m.capabilities));
  }

  private async model(user: UserRow, ref?: string): Promise<ResolvedModel> {
    const chosen = ref ?? (await this.settings.get('images')).defaultModelId ?? undefined;
    if (chosen) {
      const m = await this.catalog.resolve(chosen, user);
      if (!isImageModel(m.model.capabilities)) throw new LumenError('VALIDATION_FAILED', `${m.model.displayName} can’t generate images.`);
      return m;
    }
    const first = (await this.models(user)).find((m) => m.available);
    if (!first) throw new LumenError('FEATURE_LOCKED', 'No image generation model is set up. Ask an administrator to add one.');
    return this.catalog.resolve(first.id, user);
  }

  async generate(user: UserRow, ent: Entitlements, input: GenerateInput) {
    if (!ent.features.imageGeneration.allowed) throw new LumenError(ent.features.imageGeneration.reason === 'EMAIL_UNVERIFIED' ? 'EMAIL_VERIFICATION_REQUIRED' : 'FEATURE_LOCKED', 'Image generation isn’t available for your account.');
    const prompt = input.prompt.trim().slice(0, 4000);
    if (!prompt) throw new LumenError('VALIDATION_FAILED', 'Describe the image you want.');
    const aspectRatio = input.aspectRatio && ASPECT_RATIOS.includes(input.aspectRatio) ? input.aspectRatio : '1:1';
    const { maxPerRequest } = await this.settings.get('images');
    const n = Math.min(maxPerRequest, Math.max(1, Math.round(input.n ?? 1)));
    const m = await this.model(user, input.modelId);
    const runtime = await this.providers.runtime(m.provider.id);
    if (!runtime.adapter.generateImages) throw new LumenError('VALIDATION_FAILED', `${m.provider.name} doesn’t support image generation.`);
    // Daily cap: charge up front, refund what wasn't produced.
    await this.entitlements.consumeOrThrow(user, ent, 'images', 'imageGenPerDay', n);
    let result;
    const started = Date.now();
    try {
      result = await runtime.adapter.generateImages({ model: m.model.providerModelId, prompt, n, aspectRatio, negativePrompt: input.negativePrompt, seed: input.seed }, AbortSignal.timeout(300_000));
    } catch (err) {
      await this.entitlements.add(user.id, 'images', -n);
      await this.providers.reportFailure(m.provider.id, runtime.keyId, err);
      await this.db.insert(usageEvents).values({ userId: user.id, conversationId: input.conversationId ?? null, source: 'image', modelId: m.model.id, providerId: m.provider.id, providerKeyId: runtime.keyId, status: 'error', errorCode: err instanceof LlmError ? err.kind : 'unknown', latencyMs: Date.now() - started });
      if (err instanceof LlmError && (err.kind === 'content_filter' || /safety|content.?policy/i.test(err.message))) throw new LumenError('CONTENT_BLOCKED', 'The image provider declined this prompt. Try describing it differently.');
      if (err instanceof LlmError && err.kind === 'rate_limit') throw new LumenError('RATE_LIMITED', 'The image provider is busy. Try again shortly.');
      throw new LumenError('PROVIDER_ERROR', err instanceof Error ? err.message.slice(0, 300) : 'Image generation failed.');
    }
    await this.providers.reportSuccess(m.provider.id, runtime.keyId, 0);
    const images = result.images.slice(0, n);
    if (images.length < n) await this.entitlements.add(user.id, 'images', -(n - images.length));
    await this.db.insert(usageEvents).values({ userId: user.id, conversationId: input.conversationId ?? null, source: 'image', modelId: m.model.id, providerId: m.provider.id, providerKeyId: runtime.keyId, status: 'ok', latencyMs: Date.now() - started });
    const rows: GeneratedImageRow[] = [];
    for (const [i, img] of images.entries()) {
      const ext = img.mimeType.includes('jpeg') ? 'jpg' : img.mimeType.includes('webp') ? 'webp' : 'png';
      const file = await this.files.upload(user, ent, { name: `${slug(prompt)}-${Date.now().toString(36)}${i}.${ext}`, data: Buffer.from(img.base64, 'base64') });
      const [row] = await this.db
        .insert(generatedImages)
        .values({ userId: user.id, fileId: file.id, conversationId: input.conversationId ?? null, messageId: input.messageId ?? null, prompt, revisedPrompt: img.revisedPrompt ?? null, negativePrompt: input.negativePrompt ?? null, aspectRatio, modelId: m.model.id, modelName: m.model.displayName, seed: img.seed ?? (input.seed !== undefined ? input.seed + i : null), variationOf: input.variationOf ?? null })
        .returning();
      rows.push(row!);
    }
    return rows.map(serializeImage);
  }

  async get(user: UserRow, id: string): Promise<GeneratedImageRow> {
    const [r] = await this.db.select().from(generatedImages).where(and(eq(generatedImages.id, id), eq(generatedImages.userId, user.id)));
    if (!r) throw new LumenError('NOT_FOUND', 'Image not found.');
    return r;
  }

  /** Variations re-run the prompt with new seeds (works with every provider). */
  async variations(user: UserRow, ent: Entitlements, id: string, n: number) {
    const src = await this.get(user, id);
    return this.generate(user, ent, {
      prompt: src.prompt,
      aspectRatio: src.aspectRatio as AspectRatio,
      n,
      modelId: src.modelId ?? undefined,
      negativePrompt: src.negativePrompt ?? undefined,
      seed: Math.floor(Math.random() * 2 ** 30),
      variationOf: src.id,
      conversationId: src.conversationId,
    });
  }

  async list(user: UserRow, q: { limit: number; before?: string }) {
    const conds = [eq(generatedImages.userId, user.id)];
    if (q.before) conds.push(lt(generatedImages.createdAt, new Date(q.before)));
    const rows = await this.db.select().from(generatedImages).where(and(...conds)).orderBy(desc(generatedImages.createdAt)).limit(q.limit);
    return rows.map(serializeImage);
  }

  async byIds(user: UserRow, ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.select().from(generatedImages).where(and(eq(generatedImages.userId, user.id), inArray(generatedImages.id, ids.slice(0, 50))));
    return rows.map(serializeImage);
  }

  async delete(user: UserRow, id: string) {
    const r = await this.get(user, id);
    await this.db.delete(generatedImages).where(eq(generatedImages.id, r.id));
    const others = await this.db.select({ id: generatedImages.id }).from(generatedImages).where(eq(generatedImages.fileId, r.fileId)).limit(1);
    if (!others.length) await this.files.delete(user, [r.fileId]).catch((err: unknown) => this.log.warn({ err }, 'image file delete failed'));
  }
}
