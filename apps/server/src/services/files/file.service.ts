import { createHash } from 'node:crypto';
import { and, desc, eq, ilike, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { estimateTokens } from '@lumen/llm';
import { LumenError, wouldExceed, type Entitlements } from '@lumen/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/client.js';
import { fileChunks, files, uploadSessions, type FileRow, type UserRow } from '../../db/schema/index.js';
import type { VirusScanner } from '../../lib/clamav.js';
import type { JobQueue } from '../../lib/jobs.js';
import { safeFetch } from '../../lib/ssrf.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StorageDriver } from '../storage/storage.js';
import { chunkSections } from './chunker.js';
import type { EmbeddingService } from './embedding.service.js';
import { extract, htmlToText, type Section } from './extract.js';
import { classify, sanitizeFilename, type FileKind } from './validate.js';

export const FILE_PROCESS_JOB = 'file.process';
const MAX_TEXT_CHARS = 4_000_000;
const MAX_CHUNK_UPLOAD = 8 * 1024 * 1024;
const MAX_URL_BYTES = 10 * 1024 * 1024;

export interface FileAccess {
  /** Throws NOT_FOUND / FORBIDDEN unless the user may read (or with write=true, modify) files of the project. */
  assertProject(user: UserRow, projectId: string, write: boolean): Promise<void>;
}

export function serializeFile(f: FileRow) {
  return {
    id: f.id,
    name: f.name,
    kind: f.kind,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    projectId: f.projectId,
    sourceUrl: f.sourceUrl,
    status: f.status,
    error: f.error,
    tokenCount: f.tokenCount,
    pageCount: f.pageCount,
    chunkCount: f.chunkCount,
    embedded: f.embedded,
    metadata: f.metadata,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export class FileService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageDriver,
    private readonly settings: SettingsService,
    private readonly jobs: JobQueue,
    private readonly embeddings: EmbeddingService,
    private readonly scanner: VirusScanner,
    private readonly access: () => FileAccess,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly urlFetch: import('../../lib/ssrf.js').SsrfOptions = {},
  ) {
    this.jobs.register<{ fileId: string }>(FILE_PROCESS_JOB, ({ fileId }) => this.process(fileId), { concurrency: 2 });
  }

  async usedBytes(userId: string): Promise<number> {
    const [r] = await this.db.select({ n: sql<number>`coalesce(sum(${files.sizeBytes}), 0)::bigint` }).from(files).where(eq(files.userId, userId));
    return Number(r?.n ?? 0);
  }

  private async assertQuota(user: UserRow, ent: Entitlements, size: number) {
    if (!ent.features.fileUpload.allowed) throw new LumenError('FEATURE_LOCKED', 'File uploads are not available for your account.');
    if (size > ent.limits.maxUploadBytes) {
      throw new LumenError('PAYLOAD_TOO_LARGE', `Files can be up to ${Math.round(ent.limits.maxUploadBytes / 1024 / 1024)} MB on your plan.`, { details: { limit: ent.limits.maxUploadBytes } });
    }
    const used = await this.usedBytes(user.id);
    if (wouldExceed(used, size, ent.limits.storageBytes)) {
      throw new LumenError('STORAGE_QUOTA_EXCEEDED', 'You’re out of file storage. Delete some files to make room.', { details: { used, limit: ent.limits.storageBytes } });
    }
  }

  async upload(user: UserRow, ent: Entitlements, input: { name: string; data: Buffer; projectId?: string | null }): Promise<FileRow> {
    const name = sanitizeFilename(input.name);
    if (input.projectId) await this.access().assertProject(user, input.projectId, true);
    await this.assertQuota(user, ent, input.data.length);
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    const [dup] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.userId, user.id), eq(files.sha256, sha256), input.projectId ? eq(files.projectId, input.projectId) : isNull(files.projectId)))
      .limit(1);
    if (dup && dup.status !== 'failed') return dup;
    const cls = await classify(name, input.data);
    const infected = await this.scanner.scan(input.data).catch((e: Error) => {
      this.log.error({ err: e.message }, 'virus scanner unavailable');
      throw new LumenError('PROVIDER_UNAVAILABLE', 'File scanning is temporarily unavailable. Try again shortly.');
    });
    const [row] = await this.db
      .insert(files)
      .values({ userId: user.id, projectId: input.projectId ?? null, name, mimeType: cls.mime, kind: cls.kind, sizeBytes: input.data.length, sha256, status: infected ? 'quarantined' : 'queued', error: infected ? `Malware detected: ${infected}` : null })
      .returning();
    if (infected) {
      this.log.warn({ fileId: row!.id, userId: user.id, signature: infected }, 'file quarantined');
      return row!;
    }
    const key = `files/${user.id}/${row!.id}`;
    await this.storage.put(key, input.data, cls.mime);
    const [stored] = await this.db.update(files).set({ storageKey: key }).where(eq(files.id, row!.id)).returning();
    await this.jobs.enqueue(FILE_PROCESS_JOB, { fileId: row!.id }, { jobId: `file:${row!.id}` });
    return stored!;
  }

  async createUploadSession(user: UserRow, ent: Entitlements, input: { name: string; size: number; mimeType: string; projectId?: string | null }) {
    if (input.projectId) await this.access().assertProject(user, input.projectId, true);
    await this.assertQuota(user, ent, input.size);
    const [s] = await this.db
      .insert(uploadSessions)
      .values({ userId: user.id, projectId: input.projectId ?? null, name: sanitizeFilename(input.name), declaredMime: input.mimeType.slice(0, 200), totalBytes: input.size, expiresAt: new Date(this.now().getTime() + 24 * 3600_000) })
      .returning();
    return { id: s!.id, offset: 0, totalBytes: s!.totalBytes, maxChunkBytes: MAX_CHUNK_UPLOAD };
  }

  async uploadStatus(user: UserRow, id: string) {
    const [s] = await this.db.select().from(uploadSessions).where(and(eq(uploadSessions.id, id), eq(uploadSessions.userId, user.id)));
    if (!s) throw new LumenError('NOT_FOUND', 'Upload not found or expired.');
    return { id: s.id, offset: s.receivedBytes, totalBytes: s.totalBytes };
  }

  /** Append bytes at `offset` (must equal what we have). The final chunk assembles the file and processes it. */
  async appendChunk(user: UserRow, ent: Entitlements, id: string, offset: number, data: Buffer): Promise<{ offset: number; file: FileRow | null }> {
    if (data.length > MAX_CHUNK_UPLOAD) throw new LumenError('PAYLOAD_TOO_LARGE', 'Upload chunks must be 8 MB or smaller.');
    const [s] = await this.db.select().from(uploadSessions).where(and(eq(uploadSessions.id, id), eq(uploadSessions.userId, user.id)));
    if (!s || s.expiresAt < this.now()) throw new LumenError('NOT_FOUND', 'Upload not found or expired.');
    if (offset !== s.receivedBytes) throw new LumenError('CONFLICT', 'Offset mismatch; resume from the server offset.', { details: { offset: s.receivedBytes } });
    if (s.receivedBytes + data.length > s.totalBytes) throw new LumenError('VALIDATION_FAILED', 'More data than declared.');
    const part = s.partCount;
    await this.storage.put(`uploads/${s.id}/${String(part).padStart(6, '0')}`, data, 'application/octet-stream');
    const [u] = await this.db
      .update(uploadSessions)
      .set({ receivedBytes: s.receivedBytes + data.length, partCount: part + 1 })
      .where(and(eq(uploadSessions.id, s.id), eq(uploadSessions.receivedBytes, s.receivedBytes)))
      .returning();
    if (!u) throw new LumenError('CONFLICT', 'Concurrent upload to the same offset.');
    if (u.receivedBytes < u.totalBytes) return { offset: u.receivedBytes, file: null };
    const parts: Buffer[] = [];
    for (let i = 0; i < u.partCount; i++) {
      const obj = await this.storage.get(`uploads/${s.id}/${String(i).padStart(6, '0')}`);
      if (!obj) throw new LumenError('INTERNAL', 'Upload part missing.');
      parts.push(Buffer.concat(await obj.body.toArray()));
    }
    await this.discardSession(s.id, u.partCount);
    const file = await this.upload(user, ent, { name: s.name, data: Buffer.concat(parts), projectId: s.projectId });
    return { offset: u.totalBytes, file };
  }

  private async discardSession(id: string, parts: number) {
    for (let i = 0; i < parts; i++) await this.storage.delete(`uploads/${id}/${String(i).padStart(6, '0')}`).catch(() => undefined);
    await this.db.delete(uploadSessions).where(eq(uploadSessions.id, id));
  }

  async purgeExpiredUploads(): Promise<number> {
    const stale = await this.db.select().from(uploadSessions).where(lt(uploadSessions.expiresAt, this.now()));
    for (const s of stale) await this.discardSession(s.id, s.partCount);
    return stale.length;
  }

  /** Pasted text in a project knowledge base. */
  async createNote(user: UserRow, ent: Entitlements, projectId: string, title: string, text: string): Promise<FileRow> {
    const name = sanitizeFilename(title.endsWith('.md') ? title : `${title}.md`);
    return this.upload(user, ent, { name, data: Buffer.from(text, 'utf8'), projectId });
  }

  /** A web page in a project knowledge base, fetched SSRF-safely and optionally re-crawled. */
  async addUrl(user: UserRow, ent: Entitlements, projectId: string, url: string, recrawlHours: number | null): Promise<FileRow> {
    await this.access().assertProject(user, projectId, true);
    await this.assertQuota(user, ent, 0);
    const [row] = await this.db
      .insert(files)
      .values({ userId: user.id, projectId, name: url.slice(0, 200), mimeType: 'text/html', kind: 'url', sizeBytes: 0, sha256: createHash('sha256').update(url).digest('hex'), sourceUrl: url, recrawlHours, status: 'queued' })
      .returning();
    await this.jobs.enqueue(FILE_PROCESS_JOB, { fileId: row!.id }, { jobId: `file:${row!.id}` });
    return row!;
  }

  private async fetchUrl(url: string): Promise<{ title: string; text: string; size: number }> {
    const res = await safeFetch(url, { headers: { 'user-agent': 'LumenBot/1.0 (+knowledge base fetch)', accept: 'text/html,text/plain;q=0.9' } }, { ...this.urlFetch, timeoutMs: 20_000, maxRedirects: 5 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain|markdown)|application\/xhtml/.test(type)) throw new Error(`Unsupported content type ${type}`);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += c.length;
      if (total > MAX_URL_BYTES) throw new Error('Page is too large');
      chunks.push(Buffer.from(c));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (type.includes('html')) {
      const r = htmlToText(body, url);
      return { title: r.title, text: r.text, size: total };
    }
    return { title: url, text: body, size: total };
  }

  /** Background job: extract text, chunk, embed. Idempotent: re-running replaces previous chunks. */
  async process(fileId: string): Promise<void> {
    const [f] = await this.db.select().from(files).where(eq(files.id, fileId));
    if (!f || f.status === 'quarantined') return;
    await this.db.update(files).set({ status: 'processing', error: null, updatedAt: this.now() }).where(eq(files.id, fileId));
    try {
      const rag = await this.settings.get('rag');
      let sections: Section[];
      const meta: Record<string, unknown> = { ...f.metadata };
      let pageCount: number | null = null;
      let size = f.sizeBytes;
      let name = f.name;
      if (f.kind === 'url') {
        const page = await this.fetchUrl(f.sourceUrl!);
        sections = [{ text: page.text, location: { section: page.title || undefined } }];
        size = page.size;
        if (page.title) name = page.title.slice(0, 200);
        meta.title = page.title;
      } else {
        const obj = await this.storage.get(f.storageKey!);
        if (!obj) throw new Error('Stored file is missing.');
        const data = Buffer.concat(await obj.body.toArray());
        const ex = await extract(f.kind as FileKind, f.name, data, { maxEntries: rag.maxArchiveEntries, maxBytes: rag.maxArchiveBytes }, { stripImageMetadata: rag.stripImageMetadata });
        sections = ex.sections;
        pageCount = ex.pageCount ?? null;
        Object.assign(meta, ex.metadata ?? {});
        if (ex.sanitized) {
          await this.storage.put(f.storageKey!, ex.sanitized, f.mimeType);
          size = ex.sanitized.length;
        }
      }
      let text = sections.map((s) => (s.location.page ? `[Page ${s.location.page}]\n${s.text}` : s.location.section ? `## ${s.location.section}\n${s.text}` : s.text)).join('\n\n');
      if (text.length > MAX_TEXT_CHARS) {
        text = text.slice(0, MAX_TEXT_CHARS);
        meta.truncated = true;
      }
      const chunks = chunkSections(sections, rag.chunkTokens, rag.overlapTokens);
      const vectors = chunks.length ? await this.embeddings.embedMany(chunks.map((c) => c.content), f.userId).catch((e: Error) => {
        // Retrieval still works lexically without embeddings; record why.
        meta.embeddingError = e.message.slice(0, 300);
        return null;
      }) : null;
      await this.db.transaction(async (tx) => {
        await tx.delete(fileChunks).where(eq(fileChunks.fileId, fileId));
        for (let i = 0; i < chunks.length; i += 200) {
          await tx.insert(fileChunks).values(
            chunks.slice(i, i + 200).map((c, j) => ({
              fileId,
              userId: f.userId,
              projectId: f.projectId,
              ordinal: i + j,
              content: c.content,
              tokenCount: c.tokenCount,
              location: c.location,
              embedding: vectors?.vectors[i + j] ?? null,
              embeddingModel: vectors ? vectors.model : null,
            })),
          );
        }
        await tx
          .update(files)
          .set({ status: 'ready', name, sizeBytes: size, text, tokenCount: estimateTokens(text), pageCount, chunkCount: chunks.length, embedded: Boolean(vectors), metadata: meta, lastCrawledAt: f.kind === 'url' ? this.now() : f.lastCrawledAt, updatedAt: this.now() })
          .where(eq(files.id, fileId));
      });
    } catch (err) {
      const message = err instanceof LumenError ? err.message : `Could not read this file: ${(err as Error).message}`.slice(0, 500);
      await this.db.update(files).set({ status: 'failed', error: message, updatedAt: this.now() }).where(eq(files.id, fileId));
      if (!(err instanceof LumenError)) this.log.warn({ fileId, err: (err as Error).message }, 'file processing failed');
    }
  }

  async retry(user: UserRow, id: string) {
    const f = await this.get(user, id, true);
    if (f.status !== 'failed') throw new LumenError('CONFLICT', 'Only failed files can be retried.');
    await this.db.update(files).set({ status: 'queued' }).where(eq(files.id, id));
    await this.jobs.enqueue(FILE_PROCESS_JOB, { fileId: id }, { jobId: `file:${id}:retry:${Date.now()}` });
  }

  /** URL sources whose re-crawl interval has elapsed (called by the worker). */
  async recrawlDue(): Promise<number> {
    const due = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.kind, 'url'), sql`${files.recrawlHours} IS NOT NULL`, sql`${files.lastCrawledAt} < now() - make_interval(hours => ${files.recrawlHours})`));
    for (const d of due) await this.jobs.enqueue(FILE_PROCESS_JOB, { fileId: d.id }, { jobId: `file:${d.id}:crawl:${this.now().toISOString().slice(0, 13)}` });
    return due.length;
  }

  async get(user: UserRow, id: string, write = false): Promise<FileRow> {
    const [f] = await this.db.select().from(files).where(eq(files.id, id));
    if (!f) throw new LumenError('NOT_FOUND', 'File not found.');
    if (f.userId === user.id) return f;
    if (f.projectId) {
      try {
        await this.access().assertProject(user, f.projectId, write);
        return f;
      } catch {
        /* fall through */
      }
    }
    throw new LumenError('NOT_FOUND', 'File not found.');
  }

  async list(user: UserRow, q: { projectId?: string; kind?: string; q?: string; limit: number; before?: string }) {
    const conds: SQL[] = [];
    if (q.projectId) {
      await this.access().assertProject(user, q.projectId, false);
      conds.push(eq(files.projectId, q.projectId));
    } else conds.push(eq(files.userId, user.id));
    if (q.kind) conds.push(eq(files.kind, q.kind as FileRow['kind']));
    if (q.q) conds.push(ilike(files.name, `%${q.q.replace(/[%_\\]/g, '\\$&')}%`));
    if (q.before) conds.push(lt(files.createdAt, new Date(q.before)));
    const rows = await this.db.select().from(files).where(and(...conds)).orderBy(desc(files.createdAt)).limit(q.limit);
    return rows.map(serializeFile);
  }

  async rename(user: UserRow, id: string, name: string) {
    await this.get(user, id, true);
    const [f] = await this.db.update(files).set({ name: sanitizeFilename(name), updatedAt: this.now() }).where(eq(files.id, id)).returning();
    return f!;
  }

  async move(user: UserRow, id: string, projectId: string | null) {
    const f = await this.get(user, id, true);
    if (f.userId !== user.id) throw new LumenError('FORBIDDEN', 'Only the owner can move this file.');
    if (projectId) await this.access().assertProject(user, projectId, true);
    await this.db.update(fileChunks).set({ projectId }).where(eq(fileChunks.fileId, id));
    const [row] = await this.db.update(files).set({ projectId, updatedAt: this.now() }).where(eq(files.id, id)).returning();
    return row!;
  }

  async delete(user: UserRow, ids: string[]): Promise<number> {
    let n = 0;
    for (const id of ids) {
      const f = await this.get(user, id, true).catch(() => null);
      if (!f) continue;
      // Storage objects may be shared by duplicates (same hash) only within one row, so delete directly.
      if (f.storageKey) await this.storage.delete(f.storageKey).catch(() => undefined);
      await this.db.delete(files).where(eq(files.id, id));
      n++;
    }
    return n;
  }

  async content(user: UserRow, id: string) {
    const f = await this.get(user, id);
    if (f.status === 'quarantined') throw new LumenError('FORBIDDEN', 'This file was quarantined by the virus scanner.');
    if (!f.storageKey) throw new LumenError('NOT_FOUND', 'This item has no downloadable file.');
    const obj = await this.storage.get(f.storageKey);
    if (!obj) throw new LumenError('NOT_FOUND', 'File content is missing.');
    return { file: f, obj };
  }

  async chunk(user: UserRow, chunkId: string) {
    const [c] = await this.db.select().from(fileChunks).where(eq(fileChunks.id, chunkId));
    if (!c) throw new LumenError('NOT_FOUND', 'Source not found.');
    const f = await this.get(user, c.fileId);
    return { id: c.id, fileId: f.id, fileName: f.name, ordinal: c.ordinal, content: c.content, location: c.location };
  }

  async byIds(user: UserRow, ids: string[]): Promise<FileRow[]> {
    if (!ids.length) return [];
    const rows = await this.db.select().from(files).where(inArray(files.id, ids));
    const out: FileRow[] = [];
    for (const f of rows) {
      if (f.userId === user.id) out.push(f);
      else if (f.projectId && (await this.access().assertProject(user, f.projectId, false).then(() => true, () => false))) out.push(f);
    }
    if (out.length !== new Set(ids).size) throw new LumenError('NOT_FOUND', 'One or more files were not found.');
    return out;
  }

  async storageSummary(user: UserRow, ent: Entitlements) {
    const rows = await this.db
      .select({ kind: files.kind, n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${files.sizeBytes}),0)::bigint` })
      .from(files)
      .where(eq(files.userId, user.id))
      .groupBy(files.kind);
    const used = rows.reduce((s, r) => s + Number(r.bytes), 0);
    return { usedBytes: used, limitBytes: ent.limits.storageBytes, maxUploadBytes: ent.limits.maxUploadBytes, byKind: rows.map((r) => ({ kind: r.kind, count: r.n, bytes: Number(r.bytes) })) };
  }
}

