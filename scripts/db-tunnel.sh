#!/usr/bin/env bash
# Opens an SSH tunnel from this machine to the PRODUCTION database.
#
# Postgres on the VPS listens on 127.0.0.1 only and is closed to the internet —
# deliberately, and it stays that way. This forwards it over SSH instead of
# opening a port, so the database keeps exactly one way in.
#
#   local 127.0.0.1:55433  ->  ssh  ->  VPS 127.0.0.1:5433
#
# The local port is 55433, NOT 5433, and that choice is load-bearing.
#
# Production Postgres also listens on 5433 on its own loopback. Tunnelling to
# the same number would make the two DATABASE_URLs textually identical —
# 127.0.0.1:5433 either way — and there would be no way to tell from the URL
# which database a command was about to write to. That exact ambiguity already
# cost this project once: an admin password was set on the laptop's database
# while everyone believed it had gone to the server, and nothing in the output
# distinguished them.
#
# Usage:
#   ./scripts/db-tunnel.sh          # foreground, Ctrl-C to close
#
# Then in another terminal, with .env pointing at 55433, every command in this
# repo reads and writes production.

set -euo pipefail

VPS_HOST="${VPS_HOST:-46.225.145.196}"
VPS_USER="${VPS_USER:-deploy}"
LOCAL_PORT="${LOCAL_PORT:-55433}"
REMOTE_PORT="${REMOTE_PORT:-5433}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"

if lsof -ti:"$LOCAL_PORT" >/dev/null 2>&1; then
  echo "Cổng $LOCAL_PORT đang bị chiếm — tunnel có thể đã mở sẵn."
  echo "Kiểm: lsof -ti:$LOCAL_PORT"
  exit 1
fi

cat <<BANNER

  ┌──────────────────────────────────────────────────────────────┐
  │  ĐANG MỞ ĐƯỜNG TỚI DATABASE PRODUCTION                        │
  │                                                              │
  │  Trong lúc tunnel còn mở, mọi lệnh trong repo này ghi vào     │
  │  dữ liệu THẬT. Không có bản nháp, không có undo.              │
  │                                                              │
  │  TUYỆT ĐỐI KHÔNG chạy:                                        │
  │    prisma migrate dev     ← xoá sạch rồi dựng lại database    │
  │    prisma migrate reset   ← như trên                          │
  │    prisma db push         ← đổi schema không qua migration    │
  │                                                              │
  │  Đổi schema ở production chỉ đi qua deploy:                   │
  │    viết migration -> push -> CI -> migrate deploy trên VPS    │
  └──────────────────────────────────────────────────────────────┘

BANNER

echo "127.0.0.1:$LOCAL_PORT  ->  $VPS_USER@$VPS_HOST  ->  127.0.0.1:$REMOTE_PORT"
echo "Ctrl-C để đóng."
echo

# -N: no remote command, this is a tunnel and nothing else.
# ExitOnForwardFailure: fail loudly if the port cannot be bound, rather than
# sitting there looking connected while forwarding nothing.
# ServerAlive*: drop a dead tunnel instead of leaving a socket that accepts
# connections and never answers — a hung tunnel looks exactly like a slow
# database.
exec ssh -N \
  -i "$SSH_KEY" \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
  "$VPS_USER@$VPS_HOST"
