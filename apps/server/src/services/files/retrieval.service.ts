import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import type { EmbeddingService } from './embedding.service.js';
import { contentTerms } from './stopwords.js';

export interface RetrievedChunk {
  chunkId: string;
  fileId: string;
  fileName: string;
  content: string;
  location: { page?: number; section?: string };
  score: number;
}

export interface Scope {
  fileIds?: string[];
  projectId?: string | null;
}

const RRF_K = 60;

/** Reciprocal rank fusion of several ranked lists (robust to incomparable score scales). */
export function rrf(lists: string[][]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)));
  return scores;
}

/** Hybrid retrieval: Postgres full-text (lexical) + pgvector cosine (semantic), fused with RRF. */
export class RetrievalService {
  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingService,
  ) {}

  private scopeSql(scope: Scope): SQL | null {
    const parts: SQL[] = [];
    if (scope.fileIds?.length) parts.push(sql`c.file_id IN (${sql.join(scope.fileIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    if (scope.projectId) parts.push(sql`c.project_id = ${scope.projectId}::uuid`);
    return parts.length ? sql`(${sql.join(parts, sql` OR `)})` : null;
  }

  async search(scope: Scope, query: string, topK: number, userId: string | null): Promise<RetrievedChunk[]> {
    const where = this.scopeSql(scope);
    if (!where || !query.trim()) return [];
    const lexical = (await this.db.execute(sql`
      SELECT c.id FROM file_chunks c, websearch_to_tsquery('simple', ${query}) q
      WHERE ${where} AND c.content_tsv @@ q
      ORDER BY ts_rank_cd(c.content_tsv, q) DESC LIMIT 40`)) as unknown as { id: string }[];
    // OR-of-terms fallback so partial matches still rank (websearch is AND by default).
    const terms = contentTerms(query).slice(0, 12);
    const loose = terms.length
      ? ((await this.db.execute(sql`
          SELECT c.id FROM file_chunks c, to_tsquery('simple', ${terms.map((t) => `${t}:*`).join(' | ')}) q
          WHERE ${where} AND c.content_tsv @@ q
          ORDER BY ts_rank_cd(c.content_tsv, q) DESC LIMIT 40`)) as unknown as { id: string }[])
      : [];
    let semantic: { id: string }[] = [];
    const q = await this.embeddings.embedOne(query, userId).catch(() => null);
    if (q) {
      semantic = (await this.db.execute(sql`
        SELECT c.id FROM file_chunks c
        WHERE ${where} AND c.embedding IS NOT NULL AND c.embedding_model = ${q.model}
        ORDER BY c.embedding <=> ${`[${q.vector.join(',')}]`}::vector LIMIT 40`)) as unknown as { id: string }[];
    }
    const fused = rrf([lexical.map((r) => r.id), loose.map((r) => r.id), semantic.map((r) => r.id)]);
    const top = [...fused].sort((a, b) => b[1] - a[1]).slice(0, topK);
    if (!top.length) return [];
    const rows = (await this.db.execute(sql`
      SELECT c.id, c.file_id, c.content, c.location, f.name AS file_name
      FROM file_chunks c JOIN files f ON f.id = c.file_id
      WHERE c.id IN (${sql.join(top.map(([id]) => sql`${id}::uuid`), sql`, `)})`)) as unknown as { id: string; file_id: string; content: string; location: RetrievedChunk['location']; file_name: string }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return top
      .map(([id, score]) => {
        const r = byId.get(id);
        return r ? { chunkId: r.id, fileId: r.file_id, fileName: r.file_name, content: r.content, location: r.location, score } : null;
      })
      .filter((x): x is RetrievedChunk => x !== null);
  }
}
