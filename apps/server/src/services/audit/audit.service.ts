import { and, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { auditLogs } from '../../db/schema/index.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;

/** Strip secret-looking keys from metadata before it is persisted forever. */
export function sanitizeMetadata(meta: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.test(k)) out[k] = '[REDACTED]';
    else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 4) out[k] = sanitizeMetadata(v as Record<string, unknown>, depth + 1);
    else out[k] = v;
  }
  return out;
}

export class AuditService {
  constructor(private readonly db: Database) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      metadata: sanitizeMetadata(entry.metadata ?? {}),
    });
  }

  async list(filter: { actorId?: string; action?: string; targetId?: string; from?: Date; to?: Date; beforeId?: number; limit: number }) {
    const conds: SQL[] = [];
    if (filter.actorId) conds.push(eq(auditLogs.actorId, filter.actorId));
    if (filter.action) conds.push(sql`${auditLogs.action} LIKE ${filter.action.replace(/[%_]/g, '\\$&') + '%'}`);
    if (filter.targetId) conds.push(eq(auditLogs.targetId, filter.targetId));
    if (filter.from) conds.push(gte(auditLogs.createdAt, filter.from));
    if (filter.to) conds.push(lte(auditLogs.createdAt, filter.to));
    if (filter.beforeId) conds.push(lt(auditLogs.id, filter.beforeId));
    return this.db
      .select()
      .from(auditLogs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.id))
      .limit(filter.limit);
  }
}
