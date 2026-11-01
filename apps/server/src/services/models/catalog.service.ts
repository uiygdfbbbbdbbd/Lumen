import { asc, eq, inArray } from 'drizzle-orm';
import { LumenError, type Entitlements, type ModelInput, type ModelSummary } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { modelAliases, models, providers, type ModelRow, type ProviderRow, type UserRow } from '../../db/schema/index.js';
import type { AuditService } from '../audit/audit.service.js';
import { iconUrl } from '../providers/icons.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedModel {
  model: ModelRow;
  provider: ProviderRow;
}

type Viewer = Pick<UserRow, 'role' | 'emailVerifiedAt' | 'betaTester'>;

/** Why a model is unavailable to this viewer, or null. Admins see everything. */
export function lockReason(m: Pick<ModelRow, 'visibility'>, viewer: Viewer): ModelSummary['lockedReason'] {
  const staff = viewer.role === 'admin' || viewer.role === 'super_admin';
  if (m.visibility === 'admins' && !staff) return 'ADMINS_ONLY';
  if (m.visibility === 'beta' && !viewer.betaTester && !staff) return 'BETA_ONLY';
  if (m.visibility === 'verified' && !viewer.emailVerifiedAt && viewer.role === 'user') return 'EMAIL_UNVERIFIED';
  return null;
}

export class ModelCatalogService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly apiUrl: string,
  ) {}

  async adminList(providerId?: string) {
    const rows = await this.db
      .select()
      .from(models)
      .where(providerId ? eq(models.providerId, providerId) : undefined)
      .orderBy(asc(models.sortOrder), asc(models.displayName));
    const aliases = await this.db.select().from(modelAliases);
    return rows.map((m) => ({ ...this.serialize(m), aliases: aliases.filter((a) => a.modelId === m.id).map((a) => a.alias) }));
  }

  serialize(m: ModelRow) {
    return { ...m, iconUrl: iconUrl(this.apiUrl, m.iconKey), createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() };
  }

  async get(id: string): Promise<ModelRow> {
    const [m] = await this.db.select().from(models).where(eq(models.id, id));
    if (!m) throw new LumenError('NOT_FOUND', 'Model not found.');
    return m;
  }

  async create(providerId: string, input: ModelInput, actorId: string, ip: string) {
    const [p] = await this.db.select({ id: providers.id }).from(providers).where(eq(providers.id, providerId));
    if (!p) throw new LumenError('NOT_FOUND', 'Provider not found.');
    const { iconUrl: _icon, ...values } = input;
    const [m] = await this.db
      .insert(models)
      .values({ ...values, providerId })
      .onConflictDoNothing()
      .returning();
    if (!m) throw new LumenError('CONFLICT', 'That model already exists for this provider.');
    await this.audit.log({ actorId, action: 'model.created', targetType: 'model', targetId: m.id, ip, metadata: { providerModelId: m.providerModelId } });
    return this.serialize(m);
  }

  async update(id: string, patch: Partial<ModelInput>, actorId: string, ip: string) {
    const { iconUrl: _icon, ...values } = patch;
    if (values.fallbackModelIds?.includes(id)) throw new LumenError('VALIDATION_FAILED', 'A model cannot fall back to itself.');
    const [m] = await this.db.update(models).set({ ...values, updatedAt: new Date() }).where(eq(models.id, id)).returning();
    if (!m) throw new LumenError('NOT_FOUND', 'Model not found.');
    await this.audit.log({ actorId, action: 'model.updated', targetType: 'model', targetId: id, ip, metadata: { fields: Object.keys(values) } });
    return this.serialize(m);
  }

  async bulkSetEnabled(ids: string[], enabled: boolean, actorId: string, ip: string): Promise<number> {
    if (!ids.length) return 0;
    const res = await this.db.update(models).set({ enabled, updatedAt: new Date() }).where(inArray(models.id, ids)).returning({ id: models.id });
    await this.audit.log({ actorId, action: enabled ? 'model.bulk_enabled' : 'model.bulk_disabled', targetType: 'model', ip, metadata: { count: res.length } });
    return res.length;
  }

  async delete(id: string, actorId: string, ip: string): Promise<void> {
    const res = await this.db.delete(models).where(eq(models.id, id)).returning({ id: models.id });
    if (!res.length) throw new LumenError('NOT_FOUND', 'Model not found.');
    await this.audit.log({ actorId, action: 'model.deleted', targetType: 'model', targetId: id, ip });
  }

  async setIcon(id: string, key: string) {
    const [m] = await this.db.update(models).set({ iconKey: key }).where(eq(models.id, id)).returning();
    return m;
  }

  async listAliases() {
    return this.db.select().from(modelAliases).orderBy(asc(modelAliases.alias));
  }

  async upsertAlias(alias: string, modelId: string, description: string, actorId: string, ip: string) {
    await this.get(modelId);
    await this.db
      .insert(modelAliases)
      .values({ alias, modelId, description })
      .onConflictDoUpdate({ target: modelAliases.alias, set: { modelId, description, updatedAt: new Date() } });
    await this.audit.log({ actorId, action: 'model.alias_set', targetType: 'alias', targetId: alias, ip, metadata: { modelId } });
  }

  async deleteAlias(alias: string, actorId: string, ip: string) {
    const res = await this.db.delete(modelAliases).where(eq(modelAliases.alias, alias)).returning();
    if (!res.length) throw new LumenError('NOT_FOUND', 'Alias not found.');
    await this.audit.log({ actorId, action: 'model.alias_deleted', targetType: 'alias', targetId: alias, ip });
  }

  /** Models visible in the picker, including locked ones (shown disabled with a reason). */
  async listForUser(user: Viewer, _ent: Entitlements): Promise<ModelSummary[]> {
    const rows = await this.db
      .select({ m: models, p: providers })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .where(eq(models.enabled, true))
      .orderBy(asc(providers.sortOrder), asc(models.sortOrder), asc(models.displayName));
    const aliases = await this.db.select().from(modelAliases);
    const staff = user.role === 'admin' || user.role === 'super_admin';
    return rows
      .filter(({ p, m }) => p.enabled && (m.visibility !== 'admins' || staff))
      .map(({ m, p }) => {
        let reason = lockReason(m, user);
        if (!reason && p.healthStatus === 'down') reason = 'PROVIDER_DOWN';
        return {
          id: m.id,
          displayName: m.displayName,
          description: m.description,
          providerId: p.id,
          providerName: p.name,
          providerType: p.type,
          iconUrl: iconUrl(this.apiUrl, m.iconKey ?? p.iconKey),
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          capabilities: m.capabilities,
          tags: m.tags,
          recommended: m.recommended,
          available: reason === null || reason === 'PROVIDER_DOWN',
          lockedReason: reason,
          deprecation: m.deprecationDate ? { date: m.deprecationDate, message: m.deprecationMessage, replacementModelId: m.replacementModelId } : null,
          aliases: aliases.filter((a) => a.modelId === m.id).map((a) => a.alias),
        };
      });
  }

  /**
   * Resolve a model reference (uuid or alias) for a caller, enforcing visibility.
   * Disabled models and providers are rejected; deprecated ones past their date redirect to the replacement.
   */
  async resolve(ref: string, viewer: Viewer, depth = 0): Promise<ResolvedModel> {
    let modelId = ref;
    if (!UUID_RE.test(ref)) {
      const [a] = await this.db.select().from(modelAliases).where(eq(modelAliases.alias, ref.toLowerCase()));
      if (!a) throw new LumenError('NOT_FOUND', `Unknown model "${ref}".`);
      modelId = a.modelId;
    }
    const [row] = await this.db.select({ m: models, p: providers }).from(models).innerJoin(providers, eq(providers.id, models.providerId)).where(eq(models.id, modelId));
    if (!row || !row.m.enabled || !row.p.enabled) throw new LumenError('NOT_FOUND', 'That model is not available.');
    const reason = lockReason(row.m, viewer);
    if (reason === 'EMAIL_UNVERIFIED') throw new LumenError('EMAIL_VERIFICATION_REQUIRED', 'Verify your email to use this model.');
    if (reason) throw new LumenError('FORBIDDEN', 'You do not have access to this model.');
    if (row.m.deprecationDate && row.m.replacementModelId && depth < 3 && new Date(row.m.deprecationDate) <= new Date()) {
      return this.resolve(row.m.replacementModelId, viewer, depth + 1);
    }
    return { model: row.m, provider: row.p };
  }

  /** System lookup (embeddings, background jobs): ignores user visibility and the picker's enabled flag. */
  async resolveSystem(ref: string): Promise<ResolvedModel | null> {
    let modelId = ref;
    if (!UUID_RE.test(ref)) {
      const [a] = await this.db.select().from(modelAliases).where(eq(modelAliases.alias, ref.toLowerCase()));
      if (!a) return null;
      modelId = a.modelId;
    }
    const [row] = await this.db.select({ m: models, p: providers }).from(models).innerJoin(providers, eq(providers.id, models.providerId)).where(eq(models.id, modelId));
    return row && row.p.enabled ? { model: row.m, provider: row.p } : null;
  }

  /** Default model: user preference if usable, else admin "recommended", else first available. */
  async defaultFor(viewer: Viewer, preferred?: string): Promise<ResolvedModel | null> {
    if (preferred && preferred !== 'auto') {
      try {
        return await this.resolve(preferred, viewer);
      } catch {
        /* fall through */
      }
    }
    const list = await this.listForUser(viewer, null as never);
    const pick = list.find((m) => m.recommended && m.available) ?? list.find((m) => m.available);
    return pick ? this.resolve(pick.id, viewer) : null;
  }
}
