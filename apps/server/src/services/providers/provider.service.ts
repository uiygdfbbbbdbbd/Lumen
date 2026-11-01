import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { complete, createAdapter, LlmError, type ModelInfo, type ProviderAdapter } from '@lumen/llm';
import { LumenError, type ProviderInput, type ProviderPatch } from '@lumen/shared';
import type { Agent } from 'undici';
import type { Logger } from 'pino';
import type { Config } from '../../config/index.js';
import type { Database } from '../../db/client.js';
import { models, providerKeys, providers, users, type ProviderKeyRow, type ProviderRow } from '../../db/schema/index.js';
import { maskSecret, type SecretBox } from '../../lib/crypto.js';
import { assertSafeUrl, createSafeAgent, safeFetch, type SsrfOptions } from '../../lib/ssrf.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EmailService } from '../email/email.service.js';
import type { StorageDriver } from '../storage/storage.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { fetchIcon, iconUrl, storeIcon } from './icons.js';

export interface ProviderAdminView {
  id: string;
  name: string;
  type: ProviderRow['type'];
  description: string;
  iconUrl: string | null;
  baseUrl: string;
  headerNames: string[];
  organization: string | null;
  project: string | null;
  timeoutMs: number;
  maxRetries: number;
  region: string | null;
  allowPrivateNetwork: boolean;
  enabled: boolean;
  sortOrder: number;
  notes: string;
  health: { status: ProviderRow['healthStatus']; lastCheckedAt: string | null; latencyMs: number | null; error: string | null; circuit: string };
  keys: { id: string; label: string; keyPreview: string; weight: number; enabled: boolean; monthlySpendCapUsd: number | null; spentUsd: number; cooldownUntil: string | null; lastUsedAt: string | null; lastError: string | null }[];
  modelCount: number;
  createdAt: string;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  modelCount: number;
  sampleModels: string[];
  completion: string | null;
  error: { kind: string; message: string } | null;
}

const aadKey = (providerId: string) => `provider:${providerId}`;
const aadHeaders = (providerId: string) => `provider-headers:${providerId}`;
const month = (d: Date) => d.toISOString().slice(0, 7);

/** Guess capabilities from well-known model naming so imported models start with sensible badges. */
export function guessCapabilities(type: string, id: string) {
  const s = id.toLowerCase();
  return {
    vision: /vision|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava|pixtral|-vl|qwen.*vl|mock-vision/.test(s),
    tools: !/embed|whisper|tts|dall-e|moderation|instruct$/.test(s) && type !== 'lmstudio',
    json: /gpt|claude|gemini|mistral|command|llama|qwen|mock/.test(s),
    reasoning: /(^|[^a-z])o[1-9]|reason|think|r1|mock-reasoning|claude-(opus|sonnet)-4|gemini-2\.5/.test(s),
    audio: /audio|realtime|whisper/.test(s),
    imageGen: /dall-e|image|imagen|flux|sdxl/.test(s),
  };
}

export class ProviderService {
  readonly breaker: CircuitBreaker;
  private readonly agents = new Map<boolean, Agent>();

  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly config: Config,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.breaker = new CircuitBreaker(5, 30_000, () => this.now().getTime());
  }

  ssrfFor(p: Pick<ProviderRow, 'allowPrivateNetwork'>): SsrfOptions {
    return { allowPrivate: this.config.ALLOW_PRIVATE_PROVIDER_URLS && p.allowPrivateNetwork };
  }

  /** fetch() that refuses private/metadata addresses at connect time (unless explicitly allowed). */
  fetchFor(p: Pick<ProviderRow, 'allowPrivateNetwork'>): typeof fetch {
    const opts = this.ssrfFor(p);
    const key = Boolean(opts.allowPrivate);
    let agent = this.agents.get(key);
    if (!agent) {
      agent = createSafeAgent(opts);
      this.agents.set(key, agent);
    }
    const dispatcher = agent;
    return ((url: string, init?: RequestInit) =>
      safeFetch(String(url), init as never, { ...opts, dispatcher, maxRedirects: 0, timeoutMs: 600_000 })) as unknown as typeof fetch;
  }

  async assertBaseUrl(url: string, allowPrivateNetwork: boolean): Promise<void> {
    if (allowPrivateNetwork && !this.config.ALLOW_PRIVATE_PROVIDER_URLS) {
      throw new LumenError('SSRF_BLOCKED', 'Private network providers are disabled on this server (set ALLOW_PRIVATE_PROVIDER_URLS=true).');
    }
    await assertSafeUrl(url, this.ssrfFor({ allowPrivateNetwork }));
  }

  private toView(p: ProviderRow, keys: ProviderKeyRow[], modelCount: number): ProviderAdminView {
    let headerNames: string[] = [];
    if (p.headersEnc) {
      try {
        headerNames = Object.keys(JSON.parse(this.box.decrypt(p.headersEnc, aadHeaders(p.id))) as object);
      } catch {
        headerNames = ['(unreadable — re-enter headers)'];
      }
    }
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      description: p.description,
      iconUrl: iconUrl(this.config.API_URL, p.iconKey),
      baseUrl: p.baseUrl,
      headerNames,
      organization: p.organization,
      project: p.project,
      timeoutMs: p.timeoutMs,
      maxRetries: p.maxRetries,
      region: p.region,
      allowPrivateNetwork: p.allowPrivateNetwork,
      enabled: p.enabled,
      sortOrder: p.sortOrder,
      notes: p.notes,
      health: { status: p.healthStatus, lastCheckedAt: p.lastCheckedAt?.toISOString() ?? null, latencyMs: p.lastLatencyMs, error: p.lastError, circuit: this.breaker.state(p.id) },
      keys: keys.map((k) => ({
        id: k.id,
        label: k.label,
        keyPreview: k.keyPreview,
        weight: k.weight,
        enabled: k.enabled,
        monthlySpendCapUsd: k.monthlySpendCapUsd,
        spentUsd: k.spendMonth === month(this.now()) ? k.spentUsd : 0,
        cooldownUntil: k.cooldownUntil?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        lastError: k.lastError,
      })),
      modelCount,
      createdAt: p.createdAt.toISOString(),
    };
  }

  async list(): Promise<ProviderAdminView[]> {
    const rows = await this.db.select().from(providers).orderBy(asc(providers.sortOrder), asc(providers.name));
    if (!rows.length) return [];
    const keys = await this.db.select().from(providerKeys).where(inArray(providerKeys.providerId, rows.map((r) => r.id))).orderBy(asc(providerKeys.createdAt));
    const counts = await this.db.select({ providerId: models.providerId, n: count() }).from(models).groupBy(models.providerId);
    return rows.map((r) => this.toView(r, keys.filter((k) => k.providerId === r.id), counts.find((c) => c.providerId === r.id)?.n ?? 0));
  }

  async row(id: string): Promise<ProviderRow> {
    const [p] = await this.db.select().from(providers).where(eq(providers.id, id));
    if (!p) throw new LumenError('NOT_FOUND', 'Provider not found.');
    return p;
  }

  async get(id: string): Promise<ProviderAdminView> {
    const p = await this.row(id);
    const keys = await this.db.select().from(providerKeys).where(eq(providerKeys.providerId, id)).orderBy(asc(providerKeys.createdAt));
    const [c] = await this.db.select({ n: count() }).from(models).where(eq(models.providerId, id));
    return this.toView(p, keys, c?.n ?? 0);
  }

  async create(input: ProviderInput, actorId: string, ip: string): Promise<ProviderAdminView> {
    await this.assertBaseUrl(input.baseUrl, input.allowPrivateNetwork);
    const [p] = await this.db
      .insert(providers)
      .values({
        name: input.name,
        type: input.type,
        description: input.description,
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        organization: input.organization ?? null,
        project: input.project ?? null,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        region: input.region ?? null,
        allowPrivateNetwork: input.allowPrivateNetwork,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
        notes: input.notes,
      })
      .returning();
    const id = p!.id;
    if (input.headers && Object.keys(input.headers).length) {
      await this.db.update(providers).set({ headersEnc: this.box.encrypt(JSON.stringify(input.headers), aadHeaders(id)) }).where(eq(providers.id, id));
    }
    if (input.apiKey) await this.addKey(id, { label: 'Primary', apiKey: input.apiKey, weight: 1, monthlySpendCapUsd: null, enabled: true }, actorId, ip, false);
    if (input.iconUrl) await this.setIconFromUrl(id, input.iconUrl).catch((e: Error) => this.log.warn({ err: e.message }, 'provider icon fetch failed'));
    await this.audit.log({ actorId, action: 'provider.created', targetType: 'provider', targetId: id, ip, metadata: { name: input.name, type: input.type, baseUrl: input.baseUrl, hasKey: Boolean(input.apiKey) } });
    return this.get(id);
  }

  async update(id: string, patch: ProviderPatch, actorId: string, ip: string): Promise<ProviderAdminView> {
    const current = await this.row(id);
    const baseUrl = patch.baseUrl ?? current.baseUrl;
    const allowPrivate = patch.allowPrivateNetwork ?? current.allowPrivateNetwork;
    if (patch.baseUrl !== undefined || patch.allowPrivateNetwork !== undefined) await this.assertBaseUrl(baseUrl, allowPrivate);
    const { apiKey, headers, iconUrl: icon, ...fields } = patch;
    const set: Partial<ProviderRow> = { ...fields, updatedAt: this.now() } as Partial<ProviderRow>;
    if (patch.baseUrl) set.baseUrl = patch.baseUrl.replace(/\/+$/, '');
    if (headers === null) set.headersEnc = null;
    else if (headers) set.headersEnc = Object.keys(headers).length ? this.box.encrypt(JSON.stringify(headers), aadHeaders(id)) : null;
    await this.db.update(providers).set(set).where(eq(providers.id, id));
    if (apiKey === null) await this.db.delete(providerKeys).where(eq(providerKeys.providerId, id));
    else if (typeof apiKey === 'string' && apiKey) {
      // "Replace key" flow: overwrite the first key, or add one if none exist.
      const [first] = await this.db.select().from(providerKeys).where(eq(providerKeys.providerId, id)).orderBy(asc(providerKeys.createdAt)).limit(1);
      if (first) {
        await this.db
          .update(providerKeys)
          .set({ keyEnc: this.box.encrypt(apiKey, aadKey(id)), keyPreview: maskSecret(apiKey), cooldownUntil: null, lastError: null })
          .where(eq(providerKeys.id, first.id));
      } else await this.addKey(id, { label: 'Primary', apiKey, weight: 1, monthlySpendCapUsd: null, enabled: true }, actorId, ip, false);
    }
    if (icon) await this.setIconFromUrl(id, icon);
    await this.audit.log({
      actorId,
      action: 'provider.updated',
      targetType: 'provider',
      targetId: id,
      ip,
      metadata: { fields: Object.keys(fields), keyChanged: apiKey !== undefined, headersChanged: headers !== undefined },
    });
    return this.get(id);
  }

  async delete(id: string, actorId: string, ip: string): Promise<void> {
    const p = await this.row(id);
    await this.db.delete(providers).where(eq(providers.id, id));
    if (p.iconKey) await this.storage.delete(p.iconKey).catch(() => undefined);
    await this.audit.log({ actorId, action: 'provider.deleted', targetType: 'provider', targetId: id, ip, metadata: { name: p.name } });
  }

  async setIconFromUrl(id: string, url: string): Promise<void> {
    const p = await this.row(id);
    const key = await storeIcon(this.storage, await fetchIcon(url, {}));
    await this.db.update(providers).set({ iconKey: key }).where(eq(providers.id, id));
    if (p.iconKey) await this.storage.delete(p.iconKey).catch(() => undefined);
  }

  async setIconFromUpload(id: string, data: Buffer): Promise<ProviderAdminView> {
    const p = await this.row(id);
    const key = await storeIcon(this.storage, data);
    await this.db.update(providers).set({ iconKey: key }).where(eq(providers.id, id));
    if (p.iconKey) await this.storage.delete(p.iconKey).catch(() => undefined);
    return this.get(id);
  }

  async addKey(
    providerId: string,
    input: { label: string; apiKey: string; weight: number; monthlySpendCapUsd: number | null; enabled: boolean },
    actorId: string,
    ip: string,
    auditIt = true,
  ): Promise<void> {
    await this.row(providerId);
    await this.db.insert(providerKeys).values({
      providerId,
      label: input.label,
      keyEnc: this.box.encrypt(input.apiKey, aadKey(providerId)),
      keyPreview: maskSecret(input.apiKey),
      weight: input.weight,
      monthlySpendCapUsd: input.monthlySpendCapUsd,
      enabled: input.enabled,
      spendMonth: month(this.now()),
    });
    if (auditIt) await this.audit.log({ actorId, action: 'provider.key_added', targetType: 'provider', targetId: providerId, ip, metadata: { label: input.label } });
  }

  async updateKey(providerId: string, keyId: string, patch: Partial<{ label: string; weight: number; monthlySpendCapUsd: number | null; enabled: boolean }>, actorId: string, ip: string) {
    const res = await this.db.update(providerKeys).set(patch).where(and(eq(providerKeys.id, keyId), eq(providerKeys.providerId, providerId))).returning({ id: providerKeys.id });
    if (!res.length) throw new LumenError('NOT_FOUND', 'Key not found.');
    await this.audit.log({ actorId, action: 'provider.key_updated', targetType: 'provider', targetId: providerId, ip, metadata: { keyId, fields: Object.keys(patch) } });
  }

  async deleteKey(providerId: string, keyId: string, actorId: string, ip: string) {
    const res = await this.db.delete(providerKeys).where(and(eq(providerKeys.id, keyId), eq(providerKeys.providerId, providerId))).returning({ id: providerKeys.id });
    if (!res.length) throw new LumenError('NOT_FOUND', 'Key not found.');
    await this.audit.log({ actorId, action: 'provider.key_deleted', targetType: 'provider', targetId: providerId, ip, metadata: { keyId } });
  }

  /** Weighted random choice among usable keys: enabled, not cooling down, under monthly spend cap. */
  async selectKey(providerId: string): Promise<{ key: ProviderKeyRow; secret: string } | null> {
    const now = this.now();
    const keys = (await this.db.select().from(providerKeys).where(and(eq(providerKeys.providerId, providerId), eq(providerKeys.enabled, true)))).filter((k) => {
      if (k.cooldownUntil && k.cooldownUntil > now) return false;
      const spent = k.spendMonth === month(now) ? k.spentUsd : 0;
      return k.monthlySpendCapUsd === null || spent < k.monthlySpendCapUsd;
    });
    if (!keys.length) return null;
    const total = keys.reduce((s, k) => s + k.weight, 0);
    let r = Math.random() * total;
    const key = keys.find((k) => (r -= k.weight) < 0) ?? keys[0]!;
    return { key, secret: this.box.decrypt(key.keyEnc, aadKey(providerId)) };
  }

  headersFor(p: ProviderRow): Record<string, string> | undefined {
    return p.headersEnc ? (JSON.parse(this.box.decrypt(p.headersEnc, aadHeaders(p.id))) as Record<string, string>) : undefined;
  }

  adapterFor(p: ProviderRow, secret: string | null): ProviderAdapter {
    return createAdapter({
      type: p.type,
      baseUrl: p.baseUrl,
      apiKey: secret,
      headers: this.headersFor(p),
      organization: p.organization,
      project: p.project,
      timeoutMs: p.timeoutMs,
      fetch: this.fetchFor(p),
    });
  }

  /** Runtime entry point: an adapter plus the key it uses, so callers can report the outcome. */
  async runtime(providerId: string): Promise<{ provider: ProviderRow; adapter: ProviderAdapter; keyId: string | null }> {
    const p = await this.row(providerId);
    if (!p.enabled) throw new LumenError('PROVIDER_UNAVAILABLE', 'This model provider is disabled.');
    if (!this.breaker.allow(p.id)) throw new LumenError('PROVIDER_UNAVAILABLE', `${p.name} is temporarily unavailable. Try another model.`);
    const sel = await this.selectKey(p.id);
    const hasAnyKey = (await this.db.select({ n: count() }).from(providerKeys).where(eq(providerKeys.providerId, p.id)))[0]!.n > 0;
    if (!sel && hasAnyKey) throw new LumenError('PROVIDER_UNAVAILABLE', `${p.name} has no usable API key right now (rate limited or over budget).`);
    return { provider: p, adapter: this.adapterFor(p, sel?.secret ?? null), keyId: sel?.key.id ?? null };
  }

  async reportSuccess(providerId: string, keyId: string | null, costUsd: number): Promise<void> {
    this.breaker.success(providerId);
    if (!keyId) return;
    const [k] = await this.db.select().from(providerKeys).where(eq(providerKeys.id, keyId));
    if (!k) return;
    const m = month(this.now());
    await this.db
      .update(providerKeys)
      .set({ lastUsedAt: this.now(), lastError: null, spendMonth: m, spentUsd: (k.spendMonth === m ? k.spentUsd : 0) + costUsd })
      .where(eq(providerKeys.id, keyId));
  }

  async reportFailure(providerId: string, keyId: string | null, err: unknown): Promise<void> {
    const e = err instanceof LlmError ? err : null;
    if (!e || e.retryable) this.breaker.failure(providerId);
    if (!keyId || !e) return;
    const cooldownMs = e.kind === 'rate_limit' ? (e.retryAfterMs ?? 30_000) : e.kind === 'auth' || e.kind === 'quota' ? 5 * 60_000 : 0;
    await this.db
      .update(providerKeys)
      .set({ lastError: `${e.kind}: ${e.message}`.slice(0, 300), ...(cooldownMs ? { cooldownUntil: new Date(this.now().getTime() + cooldownMs) } : {}) })
      .where(eq(providerKeys.id, keyId));
  }

  async listRemoteModels(id: string): Promise<ModelInfo[]> {
    const p = await this.row(id);
    const sel = await this.selectKey(id);
    return this.adapterFor(p, sel?.secret ?? null).listModels(AbortSignal.timeout(15_000));
  }

  async testConnection(id: string, actorId: string | null, ip: string | null): Promise<TestResult> {
    const p = await this.row(id);
    const started = this.now().getTime();
    const result: TestResult = { ok: false, latencyMs: 0, modelCount: 0, sampleModels: [], completion: null, error: null };
    try {
      const remote = await this.listRemoteModels(id);
      result.modelCount = remote.length;
      result.sampleModels = remote.slice(0, 10).map((m) => m.id);
      const [enabledModel] = await this.db.select().from(models).where(and(eq(models.providerId, id), eq(models.enabled, true))).limit(1);
      const target = enabledModel?.providerModelId ?? remote[0]?.id;
      if (target) {
        const sel = await this.selectKey(id);
        const r = await complete(this.adapterFor(p, sel?.secret ?? null), { model: target, maxTokens: 16, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] }, AbortSignal.timeout(30_000));
        result.completion = r.text.slice(0, 200);
      }
      result.ok = true;
    } catch (err) {
      const e = err instanceof LlmError ? err : err instanceof LumenError ? err : (err as Error);
      result.error = { kind: e instanceof LlmError ? e.kind : e instanceof LumenError ? e.code : 'unknown', message: e.message.slice(0, 500) };
    }
    result.latencyMs = this.now().getTime() - started;
    await this.db
      .update(providers)
      .set({ healthStatus: result.ok ? (result.latencyMs > 10_000 ? 'degraded' : 'healthy') : 'down', lastCheckedAt: this.now(), lastLatencyMs: result.latencyMs, lastError: result.error?.message ?? null })
      .where(eq(providers.id, id));
    if (actorId) await this.audit.log({ actorId, action: 'provider.tested', targetType: 'provider', targetId: id, ip, metadata: { ok: result.ok, latencyMs: result.latencyMs } });
    return result;
  }

  async importModels(id: string, actorId: string, ip: string, opts: { enable: boolean }): Promise<{ added: number; existing: number }> {
    const p = await this.row(id);
    const remote = await this.listRemoteModels(id);
    const have = new Set((await this.db.select({ m: models.providerModelId }).from(models).where(eq(models.providerId, id))).map((r) => r.m));
    const fresh = remote.filter((m) => !have.has(m.id));
    if (fresh.length) {
      await this.db.insert(models).values(
        fresh.map((m, i) => ({
          providerId: id,
          providerModelId: m.id,
          displayName: m.displayName ?? m.id,
          contextWindow: m.contextWindow ?? 8192,
          maxOutputTokens: m.maxOutputTokens ?? 4096,
          capabilities: { ...guessCapabilities(p.type, m.id), ...(m.capabilities ?? {}) },
          enabled: opts.enable,
          sortOrder: 1000 + i,
        })),
      );
    }
    await this.audit.log({ actorId, action: 'provider.models_imported', targetType: 'provider', targetId: id, ip, metadata: { added: fresh.length } });
    return { added: fresh.length, existing: remote.length - fresh.length };
  }

  /** Periodic health check (called by the worker). Emails admins when a provider goes down. */
  async healthCheckAll(): Promise<{ id: string; status: string }[]> {
    const rows = await this.db.select().from(providers).where(eq(providers.enabled, true));
    const out: { id: string; status: string }[] = [];
    for (const p of rows) {
      const before = p.healthStatus;
      const started = this.now().getTime();
      let status: 'healthy' | 'degraded' | 'down' = 'healthy';
      let error: string | null = null;
      try {
        await this.listRemoteModels(p.id);
        if (this.now().getTime() - started > 5000) status = 'degraded';
      } catch (err) {
        status = 'down';
        error = (err as Error).message.slice(0, 500);
      }
      await this.db.update(providers).set({ healthStatus: status, lastCheckedAt: this.now(), lastLatencyMs: this.now().getTime() - started, lastError: error }).where(eq(providers.id, p.id));
      if (status === 'down' && before !== 'down') await this.alertAdmins(`Provider "${p.name}" is down`, error ?? 'Health check failed');
      out.push({ id: p.id, status });
    }
    return out;
  }

  private async alertAdmins(event: string, detail: string) {
    const admins = await this.db.select().from(users).where(inArray(users.role, ['admin', 'super_admin']));
    for (const a of admins) {
      await this.email
        .send('security_alert', a.email, { name: a.displayName, event, ip: '-', userAgent: detail.slice(0, 200), when: this.now().toUTCString(), settingsUrl: `${this.config.PUBLIC_URL}/admin/providers` })
        .catch(() => undefined);
    }
  }

  /** Re-wrap every stored secret under the active encryption key (after adding a new key to ENCRYPTION_KEYS). */
  async rotateSecrets(actorId: string, ip: string): Promise<{ rotated: number }> {
    let rotated = 0;
    for (const k of await this.db.select().from(providerKeys)) {
      if (!this.box.needsRotation(k.keyEnc)) continue;
      await this.db.update(providerKeys).set({ keyEnc: this.box.rotate(k.keyEnc, aadKey(k.providerId)) }).where(eq(providerKeys.id, k.id));
      rotated++;
    }
    for (const p of await this.db.select().from(providers)) {
      if (!p.headersEnc || !this.box.needsRotation(p.headersEnc)) continue;
      await this.db.update(providers).set({ headersEnc: this.box.rotate(p.headersEnc, aadHeaders(p.id)) }).where(eq(providers.id, p.id));
      rotated++;
    }
    for (const u of await this.db.select({ id: users.id, enc: users.totpSecretEnc }).from(users)) {
      if (!u.enc || !this.box.needsRotation(u.enc)) continue;
      await this.db.update(users).set({ totpSecretEnc: this.box.rotate(u.enc, `totp:${u.id}`) }).where(eq(users.id, u.id));
      rotated++;
    }
    await this.audit.log({ actorId, action: 'secrets.rotated', ip, metadata: { rotated } });
    return { rotated };
  }
}
