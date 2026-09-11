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

# --ensure: dùng cho predev. Idempotent — tunnel đang sống thì không làm gì,
# chưa sống thì dựng ở nền rồi trả về. Chế độ mặc định (không cờ) vẫn chạy
# tiền cảnh như cũ, vì đó là chế độ người ta gõ tay và muốn nhìn thấy.
ENSURE=no
[ "${1:-}" = "--ensure" ] && ENSURE=yes

PID_FILE="${TMPDIR:-/tmp}/pseo-db-tunnel.pid"

tunnel_alive() {
  lsof -ti:"$LOCAL_PORT" >/dev/null 2>&1
}

if tunnel_alive; then
  if [ "$ENSURE" = "yes" ]; then
    echo "Tunnel DB đã mở sẵn ở cổng $LOCAL_PORT."
    exit 0
  fi
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
# TỰ NỐI LẠI. Đây là phần sửa, không phải phần cấu hình.
#
# Các tuỳ chọn ServerAlive* ở trên đã đúng và tunnel đứt là ĐÚNG Ý: một tunnel
# treo trông giống hệt một database chậm, nên bỏ nó đi là hành vi mong muốn.
# Cái thiếu là sau khi bỏ thì không ai dựng lại, nên một lần rớt mạng vài giây
# biến thành một buổi dev hỏng cho tới khi có người gõ lại lệnh này.
#
# Vòng lặp dừng hẳn khi ssh thoát 0 (người dùng Ctrl-C) và chỉ nối lại khi ssh
# chết vì lý do khác. Nối lại vô điều kiện sẽ biến "khoá SSH sai" thành một
# vòng lặp vô hạn nói cùng một lỗi mãi mãi.
connect_loop() {
  local delay=2
  while true; do
    # `|| code=$?`, KHÔNG phải `ssh …` rồi `code=$?` ở dòng sau.
    #
    # File này mở đầu bằng `set -e`. Với nó, một lệnh thoát khác 0 giết script
    # NGAY — nên dòng bắt mã lỗi không bao giờ chạy, và vòng lặp nối lại không
    # bao giờ quay vòng. Bản đầu viết đúng như vậy: vòng lặp có mặt, đọc thì
    # đúng, và chết ở lần rớt đầu tiên.
    #
    # Đo được: giết tiến trình ssh -> cổng đóng, chờ 20s, không tự mở lại, và
    # nhật ký chỉ có đúng một dòng "Killed: 9" rồi im. Không có gì trong đầu ra
    # nói rằng vòng lặp đã chết chứ không phải đang chờ.
    local code=0
    ssh -N \
      -i "$SSH_KEY" \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
      "$VPS_USER@$VPS_HOST" || code=$?
    [ "$code" -eq 0 ] && { echo "Tunnel đóng theo yêu cầu."; return 0; }

    # 255 là "ssh không kết nối được" — mạng rớt, VPS bận, khoá bị từ chối.
    # Ba cái đầu tự khỏi, cái cuối thì không, nên lùi dần và NÓI ra số lần thử
    # thay vì im lặng quay vòng.
    echo "Tunnel đứt (mã $code). Nối lại sau ${delay}s…" >&2
    sleep "$delay"
    delay=$(( delay < 30 ? delay * 2 : 30 ))
  done
}

if [ "$ENSURE" = "yes" ]; then
  connect_loop >>"${TMPDIR:-/tmp}/pseo-db-tunnel.log" 2>&1 &
  echo $! > "$PID_FILE"
  # Chờ cổng mở thật thay vì giả định. Trả về ngay sau khi spawn sẽ để `next
  # dev` khởi động trước tunnel và trang đầu tiên vẫn lỗi đúng như cũ.
  for _ in $(seq 1 40); do
    tunnel_alive && { echo "Tunnel DB đã mở ở cổng $LOCAL_PORT (tự nối lại khi đứt)."; exit 0; }
    sleep 0.25
  done
  echo "Không mở được tunnel sau 10s. Xem ${TMPDIR:-/tmp}/pseo-db-tunnel.log" >&2
  exit 1
fi

connect_loop
