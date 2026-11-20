#!/usr/bin/env bash
# Import this repo's workflows into the docker-compose n8n (not the dev/ ones).
# Workflows are imported UNPUBLISHED. Afterwards, in the editor:
#   1. create the credentials (see README "Setup"), 2. open each workflow and
#   select the credentials, 3. publish: error workflow, support sub-workflow,
#   then the others.
# Re-importing overwrites workflows with the same id.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/docker"
for f in "$ROOT"/workflows/*.json; do
  name="$(basename "$f")"
  echo "importing $name"
  # One file per call (n8n 2.48 fails on shared tag names in a multi-file import).
  docker compose exec -T n8n n8n import:workflow --input="/workflows/$name"
done
