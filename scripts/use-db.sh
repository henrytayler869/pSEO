#!/usr/bin/env bash
# Switches this machine's .env between the LOCAL container and PRODUCTION.
#
#   ./scripts/use-db.sh local
#   ./scripts/use-db.sh production --from-vps            # lấy thẳng từ /opt/pseo/.env qua SSH
#   ./scripts/use-db.sh production                       # hỏi mật khẩu, không hiện lên màn hình
#   ./scripts/use-db.sh production /path/to/password-file
#
# The production password is read from a FILE or from a PROMPT, never from an
# argument. A secret passed on the command line is visible in `ps` to every user
# on the machine and is written into the shell history of whoever ran it. It is
# also never echoed here, and never appears in this script's output.
#
# THE PROMPT EXISTS BECAUSE THE INSTRUCTIONS WERE WRONG TWICE.
#
# The advice given for this was a bash one-liner using `read -rs -p`. In zsh —
# the default shell on macOS since Catalina — `-p` means "read from the
# coprocess", so the whole line died with "read: -p: no coprocess" and nothing
# happened, twice, while looking like a typo in the password.
#
# A step that depends on which shell someone happens to run is a step that will
# fail for somebody. Putting the prompt inside the script removes the choice:
# `stty -echo` is POSIX and behaves the same in bash, zsh, dash and sh.
#
# --from-vps EXISTS BECAUSE NOBODY HAS THE PASSWORD TO TYPE.
#
# It was generated during server setup and has lived in /opt/pseo/.env ever
# since. No human holds it, which is the correct state for a database password
# and not a problem to solve by showing it to one.
#
# So this mode copies the DATABASE_URL from that file and rewrites only the
# host and port. The password is never decoded, never re-encoded, never printed,
# and never enters anyone's screen or scrollback — it moves from one .env to
# another as an opaque string.
#
# Rewriting the URL rather than extracting the password is not a shortcut, it
# is the correctness argument: the stored password is already percent-encoded
# for a URL. Pulling it out and running it through an encoder again would
# double-encode every special character, producing a password that is wrong in
# a way that reads exactly like a typo.
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
  $0 production                                 # script sẽ hỏi mật khẩu
  $0 production <đường-dẫn-file-chứa-mật-khẩu>

Mật khẩu nhận qua chỗ hỏi hoặc qua ĐƯỜNG DẪN FILE — không bao giờ nhận
trực tiếp trên dòng lệnh, vì nó sẽ hiện trong \`ps\` và nằm lại trong lịch
sử shell.
USAGE
  exit 1
}

# Reads a secret without echoing it. stty is POSIX and behaves identically in
# bash, zsh, dash and sh — unlike `read -p`, which means two different things in
# two of them.
prompt_secret() {
  local prompt="$1"
  local value=""
  printf '%s' "$prompt" >&2
  # Restore the terminal even if the user hits Ctrl-C mid-typing; without this
  # the shell is left with echo off and looks broken.
  trap 'stty echo 2>/dev/null; printf "\n" >&2' INT
  stty -echo 2>/dev/null || true
  IFS= read -r value
  stty echo 2>/dev/null || true
  trap - INT
  printf '\n' >&2
  printf '%s' "$value"
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
    if [ "${2:-}" = "--from-vps" ]; then
      VPS_HOST="${VPS_HOST:-46.225.145.196}"
      VPS_USER="${VPS_USER:-deploy}"
      SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
      REMOTE_ENV="${REMOTE_ENV:-/opt/pseo/.env}"

      echo "Đang lấy DATABASE_URL từ ${VPS_USER}@${VPS_HOST}:${REMOTE_ENV} ..." >&2
      REMOTE_URL="$(ssh -o BatchMode=yes -o ConnectTimeout=10 -i "$SSH_KEY" "${VPS_USER}@${VPS_HOST}" \
        "sed -n 's|^DATABASE_URL=\"\{0,1\}\(postgresql://[^\"]*\)\"\{0,1\}$|\1|p' '$REMOTE_ENV'" 2>/dev/null || true)"

      if [ -z "$REMOTE_URL" ]; then
        echo "Không đọc được DATABASE_URL từ $REMOTE_ENV trên VPS." >&2
        echo "  Kiểm: ssh ${VPS_USER}@${VPS_HOST} 'grep -c DATABASE_URL $REMOTE_ENV'" >&2
        rm -f "$BACKUP"
        exit 1
      fi

      # Swap ONLY host:port. Everything before the @ — including the encoded
      # password — is carried across untouched.
      NEW_URL="$(REMOTE="$REMOTE_URL" HOSTP="${PROD_HOST}:${PROD_PORT}" python3 -c '
import os, re, sys
url = os.environ["REMOTE"]
m = re.match(r"^(postgresql://[^@]+@)([^/]+)(/.*)$", url)
if not m:
    sys.exit(1)
sys.stdout.write(m.group(1) + os.environ["HOSTP"] + m.group(3))
')" || { echo "DATABASE_URL trên VPS không đúng dạng mong đợi — không đổi gì." >&2; rm -f "$BACKUP"; exit 1; }

      write_url "$NEW_URL"
      echo "Đã lấy từ VPS. Mật khẩu không hề được giải mã, in ra, hay đi qua màn hình." >&2
      PASSWORD=""
    elif [ $# -eq 2 ]; then
      PW_FILE="$2"
      [ -f "$PW_FILE" ] || { echo "Không thấy file mật khẩu: $PW_FILE" >&2; exit 1; }
      PASSWORD="$(tr -d '\n\r' < "$PW_FILE")"
      [ -n "$PASSWORD" ] || { echo "File mật khẩu rỗng: $PW_FILE" >&2; exit 1; }
    elif [ $# -eq 1 ]; then
      PASSWORD="$(prompt_secret 'Mật khẩu DB production (gõ xong bấm Enter, chữ sẽ không hiện): ')"
      [ -n "$PASSWORD" ] || { echo "Chưa nhập gì — không đổi .env." >&2; exit 1; }
    else
      usage
    fi

    if [ -n "$PASSWORD" ]; then
    # URL-encode: a password is allowed to contain @ : / ? # & = + and a space,
    # and every one of those means something in a connection URL. Left raw, an
    # @ splits the userinfo early and Postgres is asked to connect to a host
    # that is really part of the password — which fails with "could not
    # translate host name", an error naming the one thing that is not wrong.
    ENCODED="$(PW="$PASSWORD" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PW"], safe=""))')"

    write_url "postgresql://${PROD_USER}:${ENCODED}@${PROD_HOST}:${PROD_PORT}/${PROD_DB}?schema=public"
    fi
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
