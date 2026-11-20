#!/usr/bin/env bash
# Restore a backup created by scripts/backup.sh into the docker-compose
# deployment. REPLACES the current database.
#
#   bash scripts/restore.sh backups/20260101-030000
#
# Requirements: the same N8N_ENCRYPTION_KEY in docker/.env as when the backup
# was taken (otherwise credentials cannot be decrypted).
# Untested on a real Docker host - see docs/self-hosting.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$(cd "${1:?usage: restore.sh <backup-dir>}" && pwd)"
[ -f "$SRC/n8n-db.dump" ] || { echo "No n8n-db.dump in $SRC" >&2; exit 1; }
cd "$ROOT/docker"
set -a; source .env; set +a

(cd "$SRC" && sha256sum -c --quiet SHA256SUMS) || { echo "Checksum mismatch - aborting." >&2; exit 1; }

read -r -p "This REPLACES database '$POSTGRES_DB' with $SRC. Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }

echo "[restore] stopping n8n ..."
docker compose stop n8n n8n-worker 2>/dev/null || docker compose stop n8n

echo "[restore] recreating database ..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" \
  -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_NON_ROOT_USER\";"

echo "[restore] loading dump ..."
docker compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --role="$POSTGRES_NON_ROOT_USER" --exit-on-error < "$SRC/n8n-db.dump"

echo "[restore] starting n8n ..."
docker compose start n8n
docker compose start n8n-worker 2>/dev/null || true
echo "[restore] done. Check the editor and the latest executions."
