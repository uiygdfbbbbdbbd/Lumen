#!/usr/bin/env bash
# Reset the E2E database, then start the API. A fresh DB makes the first sign-up the super admin.
set -euo pipefail
ADMIN_URL="${E2E_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB="${E2E_DB:-lumen_e2e}"
if [ -z "${E2E_SKIP_DB_RESET:-}" ]; then
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
fi
rm -rf /tmp/lumen-e2e-storage
if [ -n "${REDIS_URL:-}" ] && command -v redis-cli >/dev/null; then redis-cli -u "$REDIS_URL" flushdb >/dev/null; fi
exec pnpm --filter @lumen/server exec tsx --conditions=@lumen/source src/index.ts
