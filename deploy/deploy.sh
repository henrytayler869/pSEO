#!/usr/bin/env bash
# Runs ON THE VPS. Streamed in over SSH by .github/workflows/deploy.yml with
# the commit SHA as its only argument.
#
# Release-directory layout, so a bad deploy is one symlink away from undone:
#
#   /srv/pseo/
#     shared/.env          secrets — written once by hand, NEVER touched here
#     releases/<sha>/      one directory per deployed commit
#     current -> releases/<sha>
#
# The app's own API keys (Anthropic, Cloudflare, DataForSEO…) do NOT live in
# .env at all — they are in the database, managed through Settings. .env holds
# only what the process needs before it can reach the database, chiefly
# DATABASE_URL. That is why this script never writes it: there is nothing here
# that should be able to change a secret.

set -euo pipefail

SHA="${1:?commit sha required}"
APP_DIR=/srv/pseo
RELEASE="$APP_DIR/releases/$SHA"
SERVICE=pseo
KEEP_RELEASES=5
HEALTH_URL="http://127.0.0.1:3000/api/v1/niches"

log() { echo "[deploy $SHA] $*"; }

# Where `current` points right now, so a failed deploy can go back to it.
PREVIOUS=""
if [ -L "$APP_DIR/current" ]; then
  PREVIOUS="$(readlink -f "$APP_DIR/current")"
fi

rollback() {
  if [ -z "$PREVIOUS" ] || [ ! -d "$PREVIOUS" ]; then
    log "KHÔNG có bản trước để quay lại — service có thể đang hỏng, phải xử lý tay."
    return
  fi
  log "Quay lại bản trước: $PREVIOUS"
  ln -sfnT "$PREVIOUS" "$APP_DIR/current"
  sudo systemctl restart "$SERVICE"
}

log "Giải nén"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
tar -xzf "/tmp/release-$SHA.tar.gz" -C "$RELEASE"
rm -f "/tmp/release-$SHA.tar.gz"

# Symlinked, not copied: one file is the single source of truth for secrets,
# and a release directory can be deleted without taking it along.
ln -sfnT "$APP_DIR/shared/.env" "$RELEASE/.env"

cd "$RELEASE"

log "npm ci"
npm ci --no-audit --no-fund

log "prisma generate"
npx prisma generate

# Migrations run BEFORE the switch, while the old release is still serving.
# `migrate deploy` only applies pending migrations and never resets, so a
# failure here leaves the database untouched and the old release still live.
log "prisma migrate deploy"
if ! npx prisma migrate deploy; then
  log "MIGRATION HỎNG — không đổi bản đang chạy. Bản cũ vẫn phục vụ."
  exit 1
fi

log "next build"
if ! npm run build; then
  log "BUILD HỎNG — không đổi bản đang chạy."
  exit 1
fi

log "Chuyển sang bản mới"
ln -sfnT "$RELEASE" "$APP_DIR/current"
sudo systemctl restart "$SERVICE"

# Health check that needs no secret: an unauthenticated request to the dataset
# API must answer 401 AND must say so in OUR words.
#
# The status code alone is not enough, and the reason is the failure mode this
# project keeps meeting: 401 is what a great many things return. Anything else
# bound to port 3000 — an old release that never stopped, a stray dev server,
# a proxy in front — can produce one, and the deploy would call that healthy
# while this release is not running at all. Matching the body ties the answer
# to this application's own auth layer, and still needs no credential to
# perform.
#
# (The request goes to 127.0.0.1 deliberately, bypassing Nginx. What is being
# tested is whether THIS RELEASE serves, not whether the public entry point
# does — those are different questions and only the first one can be answered
# before traffic is switched.)
log "Kiểm tra sống"
ok=0
for i in $(seq 1 30); do
  body="$(curl -s --max-time 5 -o /tmp/health-body -w '%{http_code}' "$HEALTH_URL" || true)"
  code="$body"
  if [ "$code" = "401" ] && grep -q "provide a valid API key" /tmp/health-body 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done
rm -f /tmp/health-body

if [ "$ok" != "1" ]; then
  log "KHÔNG SỐNG sau 60s (mã cuối: ${code:-không phản hồi}) — 401 phải kèm đúng thông điệp của app"
  rollback
  exit 1
fi

log "Đang chạy bản $SHA"

# Keep a few releases so a rollback is `ln -sfnT` and a restart, not a rebuild.
cd "$APP_DIR/releases"
ls -1dt */ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  # Never delete what `current` points at, whatever the sort order says.
  if [ "$(readlink -f "$APP_DIR/current")" != "$(readlink -f "$old")" ]; then
    log "Xoá bản cũ: $old"
    rm -rf "$old"
  fi
done
