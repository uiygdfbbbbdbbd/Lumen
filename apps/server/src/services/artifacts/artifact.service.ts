import { and, asc, desc, eq, ilike, isNull, sql, type SQL } from 'drizzle-orm';
import { createTwoFilesPatch } from 'diff';
import { complete } from '@lumen/llm';
import { LumenError, type Entitlements } from '@lumen/shared';
import type { Database } from '../../db/client.js';
import { artifacts, artifactStorage, artifactVersions, ARTIFACT_TYPES, usageEvents, type ArtifactRow, type UserRow } from '../../db/schema/index.js';
import { randomToken } from '../../lib/tokens.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EntitlementService } from '../entitlements/entitlements.service.js';
import type { ModelCatalogService } from '../models/catalog.service.js';
import type { ProjectService } from '../projects/project.service.js';
import type { ProviderService } from '../providers/provider.service.js';

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_KEYS = 200;
const MAX_VALUE_BYTES = 64 * 1024;

export function serializeArtifact(a: ArtifactRow, content?: string) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    language: a.language,
    version: a.currentVersion,
    conversationId: a.conversationId,
    projectId: a.projectId,
    published: Boolean(a.publicSlug),
    publicSlug: a.publicSlug,
    forkedFrom: a.forkedFrom,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    ...(content !== undefined ? { content } : {}),
  };
}

function assertSize(content: string) {
  if (Buffer.byteLength(content, 'utf8') > MAX_ARTIFACT_BYTES) throw new LumenError('PAYLOAD_TOO_LARGE', 'Artifacts can be at most 1 MB.');
}

export class ArtifactService {
  constructor(
    private readonly db: Database,
    private readonly projects: ProjectService,
    private readonly audit: AuditService,
    private readonly catalog: ModelCatalogService,
    private readonly providers: ProviderService,
    private readonly entitlements: EntitlementService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Owner, or member of the artifact's project (editor for writes). */
  async get(user: Pick<UserRow, 'id'>, id: string, write = false): Promise<ArtifactRow> {
    const [a] = await this.db.select().from(artifacts).where(and(eq(artifacts.id, id), isNull(artifacts.deletedAt)));
    if (!a) throw new LumenError('NOT_FOUND', 'Artifact not found.');
    if (a.userId === user.id) return a;
    if (a.projectId) {
      const role = await this.projects.role(user, a.projectId);
      if (role && (!write || role !== 'viewer')) return a;
    }
    throw new LumenError('NOT_FOUND', 'Artifact not found.');
  }

  async content(id: string, version?: number): Promise<{ content: string; version: number; label: string | null; source: string; createdAt: Date }> {
    const q = this.db.select().from(artifactVersions).where(version ? and(eq(artifactVersions.artifactId, id), eq(artifactVersions.version, version)) : eq(artifactVersions.artifactId, id));
    const [v] = version ? await q : await q.orderBy(desc(artifactVersions.version)).limit(1);
    if (!v) throw new LumenError('NOT_FOUND', 'Version not found.');
    return { content: v.content, version: v.version, label: v.label, source: v.source, createdAt: v.createdAt };
  }

  async create(
    user: UserRow,
    input: { type: ArtifactType; title: string; content: string; language?: string | null; conversationId?: string | null; projectId?: string | null; messageId?: string | null; source?: string },
  ): Promise<ArtifactRow> {
    if (!ARTIFACT_TYPES.includes(input.type)) throw new LumenError('VALIDATION_FAILED', `Unknown artifact type "${input.type}".`);
    assertSize(input.content);
    const title = input.title.trim().slice(0, 200) || 'Untitled';
    return this.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(artifacts)
        .values({ userId: user.id, type: input.type, title, language: input.language?.slice(0, 40) ?? null, conversationId: input.conversationId ?? null, projectId: input.projectId ?? null })
        .returning();
      await tx.insert(artifactVersions).values({ artifactId: a!.id, version: 1, content: input.content, source: input.source ?? 'ai', messageId: input.messageId ?? null });
      return a!;
    });
  }

  private async addVersion(a: ArtifactRow, content: string, source: string, opts: { basedOn?: number; messageId?: string | null; label?: string | null } = {}): Promise<ArtifactRow> {
    assertSize(content);
    return this.db.transaction(async (tx) => {
      // Lock the row so concurrent edits get distinct, sequential version numbers.
      const [cur] = await tx.execute(sql`SELECT current_version FROM artifacts WHERE id = ${a.id} FOR UPDATE`) as unknown as { current_version: number }[];
      const next = (cur?.current_version ?? a.currentVersion) + 1;
      await tx.insert(artifactVersions).values({ artifactId: a.id, version: next, content, source, basedOn: opts.basedOn ?? next - 1, messageId: opts.messageId ?? null, label: opts.label ?? null });
      const [row] = await tx.update(artifacts).set({ currentVersion: next, updatedAt: this.now() }).where(eq(artifacts.id, a.id)).returning();
      return row!;
    });
  }

  /** Exact string replacement that must match exactly once (same contract as code-editing tools). */
  async edit(user: UserRow, id: string, oldStr: string, newStr: string, source = 'ai', messageId?: string | null): Promise<ArtifactRow> {
    const a = await this.get(user, id, true);
    const { content } = await this.content(id);
    if (!oldStr) throw new LumenError('VALIDATION_FAILED', 'old_str must not be empty.');
    const first = content.indexOf(oldStr);
    if (first < 0) throw new LumenError('VALIDATION_FAILED', 'old_str was not found in the artifact. Re-read the current content and try again.');
    if (content.indexOf(oldStr, first + 1) >= 0) throw new LumenError('VALIDATION_FAILED', 'old_str matches more than once. Include more surrounding text to make it unique.');
    return this.addVersion(a, content.slice(0, first) + newStr + content.slice(first + oldStr.length), source, { messageId });
  }

  async rewrite(user: UserRow, id: string, content: string, source = 'ai', opts: { messageId?: string | null; basedOn?: number; label?: string | null } = {}): Promise<ArtifactRow> {
    const a = await this.get(user, id, true);
    return this.addVersion(a, content, source, opts);
  }

  async restore(user: UserRow, id: string, version: number): Promise<ArtifactRow> {
    const a = await this.get(user, id, true);
    const v = await this.content(id, version);
    return this.addVersion(a, v.content, 'restore', { basedOn: version, label: `Restored v${version}` });
  }

  async versions(user: UserRow, id: string) {
    await this.get(user, id);
    const rows = await this.db
      .select({ version: artifactVersions.version, source: artifactVersions.source, label: artifactVersions.label, basedOn: artifactVersions.basedOn, createdAt: artifactVersions.createdAt, size: sql<number>`length(${artifactVersions.content})` })
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, id))
      .orderBy(desc(artifactVersions.version));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  async labelVersion(user: UserRow, id: string, version: number, label: string | null) {
    await this.get(user, id, true);
    const res = await this.db.update(artifactVersions).set({ label: label?.slice(0, 80) ?? null }).where(and(eq(artifactVersions.artifactId, id), eq(artifactVersions.version, version))).returning();
    if (!res.length) throw new LumenError('NOT_FOUND', 'Version not found.');
  }

  async diff(user: UserRow, id: string, from: number, to: number): Promise<string> {
    const a = await this.get(user, id);
    const [x, y] = await Promise.all([this.content(id, from), this.content(id, to)]);
    return createTwoFilesPatch(`${a.title} v${from}`, `${a.title} v${to}`, x.content, y.content, '', '', { context: 3 });
  }

  async patch(user: UserRow, id: string, input: { title?: string; projectId?: string | null }) {
    await this.get(user, id, true);
    if (input.projectId) await this.projects.require(user, input.projectId, 'editor');
    const [a] = await this.db
      .update(artifacts)
      .set({ ...(input.title ? { title: input.title.slice(0, 200) } : {}), ...(input.projectId !== undefined ? { projectId: input.projectId } : {}), updatedAt: this.now() })
      .where(eq(artifacts.id, id))
      .returning();
    return a!;
  }

  async delete(user: UserRow, id: string) {
    const a = await this.get(user, id);
    if (a.userId !== user.id) throw new LumenError('FORBIDDEN', 'Only the owner can delete this artifact.');
    await this.db.update(artifacts).set({ deletedAt: this.now(), publicSlug: null }).where(eq(artifacts.id, id));
  }

  async list(user: UserRow, q: { type?: ArtifactType; q?: string; conversationId?: string; limit: number }) {
    const conds: SQL[] = [eq(artifacts.userId, user.id), isNull(artifacts.deletedAt)];
    if (q.type) conds.push(eq(artifacts.type, q.type));
    if (q.q) conds.push(ilike(artifacts.title, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
    if (q.conversationId) conds.push(eq(artifacts.conversationId, q.conversationId));
    const rows = await this.db.select().from(artifacts).where(and(...conds)).orderBy(desc(artifacts.updatedAt)).limit(q.limit);
    const out = [];
    for (const r of rows) out.push({ ...serializeArtifact(r), preview: (await this.content(r.id)).content.slice(0, 400) });
    return out;
  }

  async forConversation(user: UserRow, conversationId: string) {
    const rows = await this.db.select().from(artifacts).where(and(eq(artifacts.conversationId, conversationId), eq(artifacts.userId, user.id), isNull(artifacts.deletedAt))).orderBy(asc(artifacts.createdAt));
    return rows.map((r) => serializeArtifact(r));
  }

  async fork(user: UserRow, id: string): Promise<ArtifactRow> {
    const src = await this.get(user, id);
    return this.forkRow(user, src);
  }

  async forkPublic(user: UserRow, slug: string): Promise<ArtifactRow> {
    return this.forkRow(user, await this.bySlug(slug));
  }

  private async forkRow(user: UserRow, src: ArtifactRow) {
    const { content } = await this.content(src.id);
    const a = await this.create(user, { type: src.type, title: `${src.title} (remix)`, content, language: src.language, source: 'fork' });
    const [row] = await this.db.update(artifacts).set({ forkedFrom: src.id }).where(eq(artifacts.id, a.id)).returning();
    return row!;
  }

  async publish(user: UserRow, ent: Entitlements, id: string, ip: string | null) {
    if (!ent.features.publicShareLinks.allowed) {
      throw new LumenError(ent.features.publicShareLinks.reason === 'EMAIL_UNVERIFIED' ? 'EMAIL_VERIFICATION_REQUIRED' : 'FEATURE_LOCKED', 'Verify your email to publish artifacts.');
    }
    const a = await this.get(user, id);
    if (a.userId !== user.id) throw new LumenError('FORBIDDEN', 'Only the owner can publish this artifact.');
    const slug = a.publicSlug ?? randomToken(16);
    const [row] = await this.db.update(artifacts).set({ publicSlug: slug, publishedAt: this.now() }).where(eq(artifacts.id, id)).returning();
    await this.audit.log({ actorId: user.id, action: 'artifact.published', targetType: 'artifact', targetId: id, ip });
    return row!;
  }

  async unpublish(user: UserRow, id: string, ip: string | null) {
    const a = await this.get(user, id);
    if (a.userId !== user.id) throw new LumenError('FORBIDDEN', 'Only the owner can unpublish this artifact.');
    const [row] = await this.db.update(artifacts).set({ publicSlug: null, publishedAt: null }).where(eq(artifacts.id, id)).returning();
    await this.audit.log({ actorId: user.id, action: 'artifact.unpublished', targetType: 'artifact', targetId: id, ip });
    return row!;
  }

  async bySlug(slug: string): Promise<ArtifactRow> {
    if (!/^[A-Za-z0-9_-]{16,32}$/.test(slug)) throw new LumenError('NOT_FOUND', 'Not found.');
    const [a] = await this.db.select().from(artifacts).where(and(eq(artifacts.publicSlug, slug), isNull(artifacts.deletedAt)));
    if (!a) throw new LumenError('NOT_FOUND', 'Not found.');
    return a;
  }

  // ---- Storage API for mini-apps (per artifact, per viewer; optional shared values) ----
  async storageGet(user: UserRow, id: string, key: string, shared: boolean) {
    const a = await this.accessible(user, id);
    const owner = shared ? a.userId : user.id;
    const [row] = await this.db.select().from(artifactStorage).where(and(eq(artifactStorage.artifactId, id), eq(artifactStorage.userId, owner), eq(artifactStorage.key, key), eq(artifactStorage.shared, shared)));
    return row ? row.value : null;
  }

  async storageSet(user: UserRow, id: string, key: string, value: unknown, shared: boolean) {
    const a = await this.accessible(user, id);
    if (shared && a.userId !== user.id) throw new LumenError('FORBIDDEN', 'Only the owner can write shared values.');
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_VALUE_BYTES) throw new LumenError('PAYLOAD_TOO_LARGE', 'Values can be at most 64 KB.');
    const [{ n } = { n: 0 }] = (await this.db.execute(sql`SELECT count(*)::int AS n FROM artifact_storage WHERE artifact_id = ${id} AND user_id = ${user.id}`)) as unknown as { n: number }[];
    const exists = (await this.storageGet(user, id, key, shared)) !== null;
    if (!exists && n >= MAX_KEYS) throw new LumenError('QUOTA_EXCEEDED', `At most ${MAX_KEYS} keys per artifact.`);
    await this.db
      .insert(artifactStorage)
      .values({ artifactId: id, userId: user.id, key, value: value as object, shared })
      .onConflictDoUpdate({ target: [artifactStorage.artifactId, artifactStorage.userId, artifactStorage.key], set: { value: value as object, shared, updatedAt: this.now() } });
  }

  async storageDelete(user: UserRow, id: string, key: string) {
    await this.accessible(user, id);
    await this.db.delete(artifactStorage).where(and(eq(artifactStorage.artifactId, id), eq(artifactStorage.userId, user.id), eq(artifactStorage.key, key)));
  }

  async storageList(user: UserRow, id: string) {
    await this.accessible(user, id);
    const rows = await this.db.select({ key: artifactStorage.key, shared: artifactStorage.shared }).from(artifactStorage).where(and(eq(artifactStorage.artifactId, id), eq(artifactStorage.userId, user.id)));
    return rows;
  }

  /** Owner/project member, or anyone signed in for published artifacts. */
  private async accessible(user: UserRow, id: string): Promise<ArtifactRow> {
    const [a] = await this.db.select().from(artifacts).where(and(eq(artifacts.id, id), isNull(artifacts.deletedAt)));
    if (!a) throw new LumenError('NOT_FOUND', 'Artifact not found.');
    if (a.publicSlug) return a;
    return this.get(user, id);
  }

  /** "AI inside an artifact": a single completion billed to the viewer's own quota. */
  async ai(user: UserRow, ent: Entitlements, id: string, input: { prompt: string; system?: string; maxTokens?: number }) {
    await this.accessible(user, id);
    await this.entitlements.consumeOrThrow(user, ent, 'messages', 'messagesPerDay', 1);
    const model = await this.catalog.defaultFor(user, undefined);
    if (!model) throw new LumenError('PROVIDER_UNAVAILABLE', 'No AI model is available.');
    const runtime = await this.providers.runtime(model.provider.id);
    const r = await complete(runtime.adapter, {
      model: model.model.providerModelId,
      maxTokens: Math.min(input.maxTokens ?? 1024, 4096),
      messages: [
        { role: 'system', content: `You are an AI function inside an interactive app ("artifact"). Reply with only the requested output.${input.system ? `\n\n${input.system.slice(0, 4000)}` : ''}` },
        { role: 'user', content: input.prompt },
      ],
    });
    await this.db.insert(usageEvents).values({ userId: user.id, source: 'artifact', modelId: model.model.id, providerId: model.provider.id, providerKeyId: runtime.keyId, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, status: 'ok' });
    await this.entitlements.add(user.id, 'tokens', r.usage.inputTokens + r.usage.outputTokens);
    return { text: r.text };
  }
}
