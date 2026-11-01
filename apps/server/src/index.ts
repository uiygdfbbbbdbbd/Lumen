import { buildApp } from './app.js';
import { loadConfig, ConfigError } from './config/index.js';
import { createContainer } from './container.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const c = createContainer(config);
  await runMigrations(c.dbHandle);
  await seed(c.db);
  const app = await buildApp(c);
  const shutdown = async (signal: string) => {
    c.log.info({ signal }, 'shutting down');
    await app.close();
    await c.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  await app.listen({ host: config.HOST, port: config.PORT });
}

void main();
