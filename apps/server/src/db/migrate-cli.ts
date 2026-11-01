import { loadConfig } from '../config/index.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const handle = createDb(config.DATABASE_URL, { max: 1 });
try {
  await runMigrations(handle);
  console.warn('Migrations applied.');
} finally {
  await handle.close();
}
