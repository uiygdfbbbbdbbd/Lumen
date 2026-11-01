import postgres from 'postgres';
import { createDb } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { ADMIN_URL, TEMPLATE_DB, urlFor } from './env.js';

/** Build one migrated + seeded template database; every test file clones it. */
export default async function setup() {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEMPLATE_DB} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  const handle = createDb(urlFor(TEMPLATE_DB), { max: 1 });
  try {
    await runMigrations(handle);
    await seed(handle.db);
  } finally {
    await handle.close();
  }
}
