import { loadConfig } from '../config/index.js';
import { createDb } from './client.js';
import { rollbackMigrations } from './migrate.js';

const steps = Number(process.argv[2] ?? '1');
const config = loadConfig();
const handle = createDb(config.DATABASE_URL, { max: 1 });
try {
  const done = await rollbackMigrations(handle, steps);
  console.warn(`Rolled back: ${done.join(', ') || '(nothing)'}`);
} finally {
  await handle.close();
}
