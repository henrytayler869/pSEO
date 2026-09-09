#!/usr/bin/env bash
# Switches this machine's .env between the LOCAL container and PRODUCTION.
#
#   ./scripts/use-db.sh local
#   ./scripts/use-db.sh production /path/to/password-file
#
# The production password is read from a FILE, never from an argument. A secret
# passed on the command line is visible in `ps` to every user on the machine and
# is written into the shell history of whoever ran it. It is also never echoed
# here, and never appears in this script's output.
#
# WHY A SCRIPT AND NOT A ONE-LINE EDIT
#
# Because the switch has to be reversible under stress. Pointing a laptop at the
# production database is the kind of change someone makes on a Tuesday and
# forgets by Friday, and the moment it matters — a destructive command about to
# run — the question "which database am I on?" needs an answer faster than
# reading a URL and remembering which port means what.
#
# So: every switch writes a backup, prints WHICH database is now active in
# words, and the app itself prints a warning banner on every process that talks
# to :55433 (see lib/db/prisma.ts).
#
# THE PORT ASYMMETRY IS DELIBERATE. Production Postgres listens on 5433 on its
# own loopback; the tunnel maps it to 55433 here. Using the same number both
# sides would make the two DATABASE_URLs textually identical and there would be
# no way to tell from the URL which database a command was about to write to.

set -euo pipefail

ENV_FILE=".env"
LOCAL_URL='postgresql://pseo:pseo@localhost:5433/pseo_control_panel?schema=public'
PROD_HOST="127.0.0.1"
PROD_PORT="55433"
PROD_USER="pseo"
PROD_DB="pseo_control_panel"

usage() {
  cat >&2 <<USAGE
Cách dùng:
  $0 local
  $0 production <đường-dẫn-file-chứa-mật-khẩu>

Mật khẩu nhận qua ĐƯỜNG DẪN FILE, không nhận trực tiếp trên dòng lệnh.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
MODE="$1"

[ -f "$ENV_FILE" ] || { echo "Không thấy $ENV_FILE trong $(pwd)" >&2; exit 1; }

BACKUP="${ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp "$ENV_FILE" "$BACKUP"

write_url() {
  # Rewrites only the DATABASE_URL line; every other variable in .env is left
  # untouched. Rewriting the whole file would silently drop anything added
  # since this script was written.
  local url="$1"
  if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
    # A literal replacement done in awk, not sed: the URL contains / and ? and
    # & and any sed delimiter chosen here would eventually collide with a
    # password character and corrupt the line.
    awk -v url="$url" '/^DATABASE_URL=/ { print "DATABASE_URL=\"" url "\""; next } { print }' \
      "$ENV_FILE" > "${ENV_FILE}.tmp"
  else
    cp "$ENV_FILE" "${ENV_FILE}.tmp"
    printf 'DATABASE_URL="%s"\n' "$url" >> "${ENV_FILE}.tmp"
  fi
  mv "${ENV_FILE}.tmp" "$ENV_FILE"
}

case "$MODE" in
  local)
    write_url "$LOCAL_URL"
    echo "Đã chuyển sang DATABASE CỤC BỘ (container, cổng 5433)."
    echo "  Mọi thay đổi chỉ nằm trên máy này."
    ;;

  production)
    [ $# -eq 2 ] || usage
    PW_FILE="$2"
    [ -f "$PW_FILE" ] || { echo "Không thấy file mật khẩu: $PW_FILE" >&2; exit 1; }
    PASSWORD="$(tr -d '\n\r' < "$PW_FILE")"
    [ -n "$PASSWORD" ] || { echo "File mật khẩu rỗng: $PW_FILE" >&2; exit 1; }

    # URL-encode: a password is allowed to contain @ : / ? # & = + and a space,
    # and every one of those means something in a connection URL. Left raw, an
    # @ splits the userinfo early and Postgres is asked to connect to a host
    # that is really part of the password — which fails with "could not
    # translate host name", an error naming the one thing that is not wrong.
    ENCODED="$(PW="$PASSWORD" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PW"], safe=""))')"

    write_url "postgresql://${PROD_USER}:${ENCODED}@${PROD_HOST}:${PROD_PORT}/${PROD_DB}?schema=public"
    cat <<BANNER

  ┌──────────────────────────────────────────────────────────────┐
  │  MÁY NÀY GIỜ TRỎ VÀO DATABASE PRODUCTION                      │
  │                                                              │
  │  Mọi lệnh trong repo này ghi vào dữ liệu THẬT.                │
  │  Không có bản nháp, không có undo.                            │
  │                                                              │
  │  TUYỆT ĐỐI KHÔNG chạy:                                        │
  │    prisma migrate dev     ← xoá sạch rồi dựng lại database    │
  │    prisma migrate reset   ← như trên                          │
  │    prisma db push         ← đổi schema không qua migration    │
  │                                                              │
  │  Cần tunnel đang mở:  ./scripts/db-tunnel.sh                  │
  │  Quay lại cục bộ:     ./scripts/use-db.sh local               │
  └──────────────────────────────────────────────────────────────┘

BANNER
    ;;

  *)
    usage
    ;;
esac

echo "Bản .env trước đó đã lưu tại: $BACKUP"
