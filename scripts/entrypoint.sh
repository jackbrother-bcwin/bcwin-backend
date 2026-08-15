#!/usr/bin/env bash
# Apply pending Prisma migrations before starting the process.
# Use as container/PM2 pre-start so prod DB never lags behind schema.
set -euo pipefail

SCHEMA="${PRISMA_SCHEMA:-packages/db/schema.prisma}"

echo "[entrypoint] prisma migrate deploy --schema=${SCHEMA}"
bunx prisma migrate deploy --schema="${SCHEMA}"

echo "[entrypoint] starting: $*"
exec "$@"
