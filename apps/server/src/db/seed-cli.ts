import { loadConfig } from '../config/index.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { seed } from './seed.js';

const config = loadConfig();
const handle = createDb(config.DATABASE_URL, { max: 1 });
try {
  await runMigrations(handle);
  await seed(handle.db);
  console.warn('Seed complete.');
} finally {
  await handle.close();
}
