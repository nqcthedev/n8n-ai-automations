#!/usr/bin/env bash
# Back up a docker-compose n8n deployment (docker/docker-compose.yml):
#   1. PostgreSQL dump (everything: workflows, credentials, executions, users)
#   2. Workflow + credential export as JSON (credentials stay ENCRYPTED with
#      N8N_ENCRYPTION_KEY) - handy for diffing or moving single workflows
# Keeps the newest $BACKUP_KEEP backups (default 14).
#
#   bash scripts/backup.sh            # e.g. from cron: 0 3 * * * cd /opt/n8n-ai && bash scripts/backup.sh
#
# IMPORTANT: also store N8N_ENCRYPTION_KEY (docker/.env) somewhere safe and
# separate from the backups. Without it the credentials cannot be decrypted.
# Untested on a real Docker host - see docs/self-hosting.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/docker"
set -a; source .env; set +a

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/backups/$TS"
KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$OUT"
umask 077

echo "[backup] PostgreSQL dump ..."
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner \
  > "$OUT/n8n-db.dump"

echo "[backup] workflow + credential export ..."
docker compose exec -T n8n sh -c "rm -rf /tmp/n8n-export && mkdir -p /tmp/n8n-export/workflows /tmp/n8n-export/credentials \
  && n8n export:workflow --backup --output=/tmp/n8n-export/workflows/ \
  && n8n export:credentials --backup --output=/tmp/n8n-export/credentials/" >/dev/null
docker compose cp n8n:/tmp/n8n-export/workflows "$OUT/workflows" >/dev/null
docker compose cp n8n:/tmp/n8n-export/credentials "$OUT/credentials" >/dev/null
docker compose exec -T n8n rm -rf /tmp/n8n-export

(cd "$OUT" && find . -type f ! -name SHA256SUMS -exec sha256sum {} + > SHA256SUMS)
echo "[backup] done: $OUT ($(du -sh "$OUT" | cut -f1))"

# Retention
ls -1dt "$ROOT"/backups/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -rf
