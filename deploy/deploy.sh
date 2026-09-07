#!/usr/bin/env bash
# Runs ON THE VPS. Streamed in over SSH by .github/workflows/deploy.yml with
# the commit SHA as its only argument.
#
# Written against the machine as it actually is (46.225.145.196, read from the
# box 2026-09-07), not against a layout this repo would have preferred:
#
#   /opt/pseo            a plain git checkout, updated in place. NOT /srv, and
#                        NOT a releases/ + current symlink layout.
#   user deploy          runs the service and owns the checkout. No pseo user.
#   /opt/pseo/.env       0600, loaded by Next itself from the working
#                        directory. systemd does NOT read it, deliberately:
#                        systemd parses quoting differently from dotenv, and an
#                        EnvironmentFile pointing here would load it twice
#                        under two sets of rules.
#   Postgres             Docker, 127.0.0.1:5433. The deploy user is NOT in the
#                        docker group and must not be — that group is
#                        equivalent to root, which would make the narrow
#                        sudoers rule decorative.
#
# NEVER run "git clean -fdx" here. Two required files in /opt/pseo are
# untracked: .env, and docker-compose.override.yml which carries the real
# database password. Cleaning would delete both, killing the app and losing the
# password. "git reset --hard" leaves untracked files alone, which is why it is
# the verb used below.

set -euo pipefail

SHA="${1:?commit sha required}"
APP_DIR=/opt/pseo
SERVICE=pseo
HEALTH_URL="http://127.0.0.1:3000/api/v1/niches"

log() { echo "[deploy ${SHA:0:8}] $*"; }

cd "$APP_DIR"

PREVIOUS="$(git rev-parse HEAD)"
log "Đang ở ${PREVIOUS:0:8}, chuyển sang ${SHA:0:8}"

# Rolling back an in-place checkout costs a rebuild — there is no previous
# build sitting in a sibling directory to point at. That is the price of this
# layout, and it is the layout the machine has.
rollback() {
  log "HỎNG — quay lại ${PREVIOUS:0:8}"
  git reset --hard "$PREVIOUS"
  npm ci --no-audit --no-fund
  npx prisma generate
  npm run build
  sudo systemctl restart "$SERVICE"
  log "Đã quay lại ${PREVIOUS:0:8}"
}

log "git fetch + reset (KHÔNG clean — .env và docker-compose.override.yml là untracked)"
git fetch --prune origin
# Reset to the exact SHA that CI verified, not to origin/main: another push can
# land while this deploy is running, and origin/main would silently ship a
# commit no gate has seen.
git reset --hard "$SHA"

log "npm ci"
if ! npm ci --no-audit --no-fund; then
  log "npm ci hỏng"
  rollback
  exit 1
fi

# Migrations run while the OLD build is still serving: .next has not been
# touched yet and the service has not restarted. "migrate deploy" only applies
# pending migrations and never resets, so a failure here leaves the database
# exactly as it was.
log "prisma migrate deploy"
if ! npx prisma migrate deploy; then
  log "MIGRATION HỎNG — database không đổi, app cũ vẫn phục vụ"
  git reset --hard "$PREVIOUS"
  exit 1
fi

log "prisma generate"
npx prisma generate

log "next build"
if ! npm run build; then
  log "BUILD HỎNG"
  rollback
  exit 1
fi

log "restart (downtime ~5s)"
sudo systemctl restart "$SERVICE"

# Health check that needs no secret: an unauthenticated request to the dataset
# API must answer 401 AND say so in OUR words.
#
# The status code alone does not identify who answered. Anything holding port
# 3000 — an old process that never stopped, a stray dev server, a proxy — can
# return 401, and the deploy would record that as healthy while this release is
# not running. Matching the body ties the answer to this application's own auth
# layer.
#
# Sent to 127.0.0.1, deliberately bypassing Nginx: the question is whether THIS
# release serves, not whether the public entry point does.
#
# The phrase below is AUTH_FAILURE_ANCHOR in lib/api/auth.ts. Bash cannot
# import it, so the two are coupled by hand — deliberately a short fragment
# rather than the whole sentence, since the surrounding wording is prose and
# will get edited. If someone moves the anchor, this check fails loudly and the
# deploy rolls back saying why; it does not quietly start passing.
log "Kiểm tra sống"
ok=0
code=""
for _ in $(seq 1 30); do
  code="$(curl -s --max-time 5 -o /tmp/pseo-health -w '%{http_code}' "$HEALTH_URL" || true)"
  if [ "$code" = "401" ] && grep -q "provide a valid API key" /tmp/pseo-health 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done
rm -f /tmp/pseo-health

if [ "$ok" != "1" ]; then
  log "KHÔNG SỐNG sau 60s (mã cuối: ${code:-không phản hồi}) — 401 phải kèm đúng thông điệp của app"
  rollback
  exit 1
fi

log "Đang chạy ${SHA:0:8}"
