import { customType } from 'drizzle-orm/pg-core';

export const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
/** Dimension-less pgvector column: any embedding model can be used; searches are owner-scoped exact scans. */
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector',
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => JSON.parse(v) as number[],
});
