#!/bin/sh
set -e

echo "[entrypoint] Applying database schema..."
# Use db execute instead of migrate deploy to avoid advisory lock issues
# on Azure PostgreSQL Flexible Server. The migration SQL is idempotent
# (IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate_object) so it is safe
# to run on every startup — it is a no-op when the schema already exists.
node /app/node_modules/prisma/build/index.js db execute \
  --file /app/prisma/migrations/20260302000000_init/migration.sql \
  --schema /app/prisma/schema.prisma

node /app/node_modules/prisma/build/index.js db execute \
  --file /app/prisma/migrations/20260302000001_add_optional_fields/migration.sql \
  --schema /app/prisma/schema.prisma

echo "[entrypoint] Starting Next.js server..."
exec node /app/server.js
