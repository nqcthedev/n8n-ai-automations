#!/usr/bin/env bash
# Run n8n locally (SQLite, no Docker) with all workflows of this repo imported.
#
#   npm run local                       # install (first run), import, start on :5678
#   bash scripts/local-n8n.sh --import-only   # (re)import workflows, don't start
#   bash scripts/local-n8n.sh --no-import     # start with the existing local data
#
# - Installs n8n into ./.n8n-local (git-ignored) on first run.
# - n8n 2.x needs Node >= 24. If the system Node is older, a Node 24 binary is
#   installed from the npm registry into ./.n8n-local (Linux x64 only).
# - Creates the LLM credential from LLM_BASE_URL / LLM_API_KEY and harmless
#   placeholder credentials for Slack / Gmail / Google Sheets (so the canvas
#   shows no missing-credential warnings; those nodes cannot run with them).
# - Gmail-trigger nodes are imported *disabled* locally (no Gmail account), so
#   the webhook-based workflows can be activated.
# - Creates a local owner account for the editor (see LOCAL_OWNER_* below).
#
# Configuration: .env.local (git-ignored) overrides config/local.env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL="$ROOT/.n8n-local"
N8N_VERSION="${N8N_VERSION:-2.48.6}"
NODE24_VERSION="24.22.3"
MODE="${1:-start}"

set -a
# shellcheck disable=SC1091
source "$ROOT/config/local.env"
# shellcheck disable=SC1091
[ -f "$ROOT/.env.local" ] && source "$ROOT/.env.local"
set +a

if [ -z "${LLM_API_KEY:-}" ]; then
  echo "ERROR: LLM_API_KEY is empty. Put it in .env.local (see config/local.env)." >&2
  exit 1
fi

mkdir -p "$LOCAL"
[ -f "$LOCAL/package.json" ] || echo '{"name":"n8n-local","private":true}' > "$LOCAL/package.json"

# ---------------------------------------------------------------- Node >= 24
NODE_BIN="$(command -v node)"
if [ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  if [ ! -x "$LOCAL/node_modules/node-linux-x64/bin/node" ]; then
    echo "System Node is < 24; installing Node $NODE24_VERSION binary from npm into .n8n-local ..."
    (cd "$LOCAL" && npm install --no-audit --no-fund "node-linux-x64@$NODE24_VERSION")
  fi
  NODE_BIN="$LOCAL/node_modules/node-linux-x64/bin/node"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

# ---------------------------------------------------------------- n8n install
if [ ! -f "$LOCAL/node_modules/n8n/package.json" ] || \
   [ "$(node -p "require('$LOCAL/node_modules/n8n/package.json').version")" != "$N8N_VERSION" ]; then
  echo "Installing n8n@$N8N_VERSION into .n8n-local (large download, a few minutes) ..."
  (cd "$LOCAL" && npm install --no-audit --no-fund "n8n@$N8N_VERSION" && npm rebuild isolated-vm sqlite3)
fi
N8N=("node" "$LOCAL/node_modules/n8n/bin/n8n")

# ---------------------------------------------------------------- n8n env
export N8N_USER_FOLDER="$LOCAL"            # data lives in .n8n-local/.n8n
export N8N_PORT="${N8N_PORT:-5678}"
export N8N_LISTEN_ADDRESS="${N8N_LISTEN_ADDRESS:-127.0.0.1}"   # local only
export N8N_HOST="localhost"
export N8N_PROTOCOL="http"
export N8N_EDITOR_BASE_URL="http://localhost:$N8N_PORT/"
export N8N_WEBHOOK_URL="http://localhost:$N8N_PORT/"
export N8N_SECURE_COOKIE=false
export N8N_DIAGNOSTICS_ENABLED=false
export N8N_PERSONALIZATION_ENABLED=false
export N8N_VERSION_NOTIFICATIONS_ENABLED=false
export N8N_TEMPLATES_ENABLED=false
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false
export N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
export N8N_RUNNERS_TASK_TIMEOUT=120
export N8N_LOG_LEVEL="${N8N_LOG_LEVEL:-info}"
export GENERIC_TIMEZONE="${GENERIC_TIMEZONE:-UTC}"

# ---------------------------------------------------------------- build + import
if [ "$MODE" != "--no-import" ]; then
echo "Building workflow JSON ..."
node "$ROOT/src/build-workflows.mjs" >/dev/null

STAGE="$LOCAL/import"
rm -rf "$STAGE" && mkdir -p "$STAGE/workflows"
node "$ROOT/scripts/lib/prepare-local-import.mjs" "$ROOT/workflows" "$STAGE"

echo "Importing credentials and workflows ..."
"${N8N[@]}" import:credentials --input="$STAGE/credentials.json" 2>&1 | grep -E "Successfully|rror" || true
# One file per call: n8n 2.48 fails on shared tag names within a single --separate import.
for f in "$STAGE"/workflows/*.json; do
  "${N8N[@]}" import:workflow --input="$f" 2>&1 | grep -E "Successfully|rror" || true
done
for id in $(cat "$STAGE/publish-ids.txt"); do
  "${N8N[@]}" publish:workflow --id="$id" 2>&1 | grep -E "Publish|rror|not found|fail|Cannot" || true
done
rm -f "$STAGE/credentials.json"   # contains the LLM key in plain text
fi

if [ "$MODE" = "--import-only" ]; then
  echo "Import done (not starting n8n)."
  exit 0
fi

# ---------------------------------------------------------------- start
node "$ROOT/scripts/lib/setup-owner.mjs" "http://localhost:$N8N_PORT" &
echo ""
echo "Starting n8n on http://localhost:$N8N_PORT  (login: $LOCAL_OWNER_EMAIL / see config/local.env)"
echo "  Lead webhook:    POST http://localhost:$N8N_PORT/webhook/lead-intake"
echo "  Invoice webhook: POST http://localhost:$N8N_PORT/webhook/invoice-upload  (multipart field: file)"
echo "  AUTOMATION_DRY_RUN=$AUTOMATION_DRY_RUN"
echo ""
exec "${N8N[@]}" start
