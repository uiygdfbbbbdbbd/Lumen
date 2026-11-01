import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().max(512).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Keyset cursor: sort value + id tiebreaker. Opaque to clients. */
export interface Cursor {
  v: string | number;
  id: string;
}

const cursorSchema = z.object({ v: z.union([z.string(), z.number()]), id: z.string() });

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/** Returns null for malformed cursors instead of throwing, so bad input is treated as "first page". */
export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(fromBase64Url(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Build a page from `limit + 1` fetched rows: the extra row signals more data.
 */
export function buildPage<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}
