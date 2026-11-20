# Self-hosting guide

How to run n8n in production with the Docker Compose stack in [`docker/`](../docker).

> **Status:** the compose file targets n8n **2.48.6**. It passes `docker compose config` validation and was reviewed carefully, but it has **not been started on a real Docker host yet** (the development machine had no Docker daemon). The workflows themselves were verified on a local n8n 2.48.6 install (see the README, "Testing"). Treat the first deployment as a supervised one.

## What you get

| Service | Profile | Purpose |
|---|---|---|
| `postgres` (16-alpine) | default | n8n database. n8n connects as a non-root user created by `init-data.sh`. |
| `n8n` | default | Editor, webhooks, triggers. Bound to `127.0.0.1:5678` only. |
| `caddy` (2-alpine) | `https` | Reverse proxy with automatic Let's Encrypt certificates, HSTS, 20 MB upload limit. |
| `redis` + `n8n-worker` | `queue` | Queue mode: the main instance enqueues executions, workers run them. Scale workers with `--scale n8n-worker=N`. |

Binary data (uploaded PDFs) is stored in PostgreSQL (`N8N_DEFAULT_BINARY_DATA_MODE=database`), so the main instance and the workers share it without a shared volume or S3.

## Server requirements

- Any Linux VPS with Docker Engine 24+ and the Compose plugin. 2 vCPU / 4 GB RAM is plenty for regular mode at SMB volumes. Use 4 GB+ if you run queue mode with 2+ workers.
- A domain or subdomain (e.g. `n8n.example.com`) with an A/AAAA record pointing to the server.
- Ports 80 and 443 open (for Caddy). Port 5678 should **not** be open.

## Install

```bash
git clone <this repo> /opt/n8n-ai && cd /opt/n8n-ai/docker
cp .env.example .env
# Generate secrets:
openssl rand -hex 32   # -> N8N_ENCRYPTION_KEY
openssl rand -hex 24   # -> POSTGRES_PASSWORD
openssl rand -hex 24   # -> POSTGRES_NON_ROOT_PASSWORD
nano .env              # set N8N_HOST, ACME_EMAIL, secrets, workflow settings
chmod 600 .env

docker compose --profile https up -d
docker compose logs -f n8n          # wait for "Editor is now accessible"
```

Open `https://<N8N_HOST>`, create the owner account (use a strong password and enable 2FA under *Settings > Personal*), then follow the README "Production setup" steps: import workflows, create credentials, create the Google Sheet, publish.

```bash
bash ../scripts/import-workflows-docker.sh
```

**Back up `N8N_ENCRYPTION_KEY` now**, in a password manager and separately from the server backups. Without it, a restored database cannot decrypt any credentials.

## HTTPS options

- **Caddy (included):** `--profile https`. Certificates are issued and renewed automatically. Keep `N8N_PROTOCOL=https`, `N8N_SECURE_COOKIE=true` and `N8N_PROXY_HOPS=1`.
- **Your own proxy** (Nginx, Traefik, Cloudflare Tunnel): skip the profile, proxy to `127.0.0.1:5678`, forward `X-Forwarded-*` headers, allow WebSocket upgrades (the editor uses them) and a body size of at least 20 MB. Set `N8N_PROXY_HOPS` to the number of proxies.
- **Restrict the editor:** the Caddyfile contains a commented `@editor` block. Enable it to allow the editor UI only from your office/VPN IP ranges while keeping `/webhook/*` and `/webhook-waiting/*` public. Slack approval links use `/webhook-waiting/`.

## Queue mode (optional)

Use it when executions pile up or long LLM calls should not slow down webhook responses.

```bash
# in docker/.env
EXECUTIONS_MODE=queue

docker compose --profile https --profile queue up -d --scale n8n-worker=2
```

Notes:
- The main instance and the workers read the same `.env` through a shared YAML anchor, so they always have the same encryption key, database and workflow settings.
- `OFFLOAD_MANUAL_EXECUTIONS_TO_WORKERS=true`: manual test runs in the editor also go to workers (n8n's recommended setting).
- The dedupe registries (lead emails, invoice hashes/numbers) live in workflow static data. With several workers processing the **same** workflow at the same moment, two near-simultaneous duplicates could both get through. At higher volume, move those checks to a database table (see README, limitations).
- Code nodes run in n8n's internal task runner (`N8N_RUNNERS_MODE=internal`). n8n recommends external runner containers for stronger isolation. If you need that, see n8n's "task runners" docs.

## Backups

```bash
bash scripts/backup.sh             # from the repo root
# cron, daily 03:00:
0 3 * * * cd /opt/n8n-ai && bash scripts/backup.sh >> /var/log/n8n-backup.log 2>&1
```

Each backup in `backups/<timestamp>/` contains:
- `n8n-db.dump`: a full `pg_dump` (workflows, credentials, execution history, users, workflow static data)
- `workflows/`, `credentials/`: JSON exports (credentials stay encrypted)
- `SHA256SUMS`

The newest 14 backups are kept (`BACKUP_KEEP=30 bash scripts/backup.sh` to change this). Copy `backups/` off the server: rsync to another host, restic, or S3 with `rclone`.

### Restore

```bash
bash scripts/restore.sh backups/20261120-030000
```

The script verifies checksums, asks for confirmation, stops n8n, recreates the database from the dump and starts n8n again. The same `N8N_ENCRYPTION_KEY` must be in `docker/.env`.

**Test your restore** at least once on a second machine. A backup you have never restored is a hope, not a backup.

## Upgrades

n8n releases often, and major versions contain breaking changes. The safe routine:

1. Read the release notes between your version and the target. n8n 2.x ships a breaking-changes check that flags affected workflows and settings before a major upgrade; look for it in the editor settings of your current version.
2. `bash scripts/backup.sh`
3. Change `N8N_VERSION` in `docker/.env` (always pin an exact version; never use `latest` in production).
4. `docker compose pull && docker compose --profile https up -d` (add `--profile queue` if used). Database migrations run automatically on start: watch `docker compose logs -f n8n`.
5. Open each workflow, check the latest executions, and run `AUTOMATION_DRY_RUN=true` tests if node versions changed.
6. If something breaks: set the old `N8N_VERSION` and restore the backup taken in step 2. Migrations are not reversible by downgrading alone.

Things to watch in this repo when upgrading:
- The workflows pin node `typeVersion`s, so n8n keeps running them with the same behaviour after an upgrade. New node versions are only used when you replace a node.
- The **OpenAI Chat Model** node is configured with `responsesApiEnabled: false` (Chat Completions API), which is what Gemini and most OpenAI-compatible providers support. Keep it that way if you switch provider.
- n8n 2.x requires sub-workflows and error workflows to be **published** before the workflows that use them.

## Monitoring

- `GET https://<N8N_HOST>/healthz` returns `{"status":"ok"}`. Point an uptime monitor (UptimeRobot, Better Stack, ...) at it.
- The **Error Alerts** workflow reports every failed production execution to Slack and email.
- Execution history is pruned after `EXECUTIONS_DATA_MAX_AGE` hours (default 336 = 14 days).
- `docker compose ps` / `docker stats` show container health and resource usage.

## Security checklist

- [ ] `.env` is `chmod 600`, never committed, and the encryption key is backed up separately
- [ ] Port 5678 is not reachable from the internet (`ss -ltnp`; it should only listen on 127.0.0.1)
- [ ] Owner account has 2FA. Other users get the least privileges they need.
- [ ] Editor restricted by IP or VPN, if possible (Caddyfile `@editor` block)
- [ ] Invoice upload webhook protected with Header Auth if only your systems upload
- [ ] OS security updates enabled (`unattended-upgrades`), firewall allows only 22/80/443
- [ ] Backups copied off-server and restore tested
