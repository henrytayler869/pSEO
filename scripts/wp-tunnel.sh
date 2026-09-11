#!/usr/bin/env bash
# Mở đường SSH từ máy này tới WORDPRESS của publisher trên VPS.
#
# WordPress nghe 127.0.0.1:8090 trên VPS và đóng với internet — cố ý, và giữ
# nguyên như vậy. Đường công khai duy nhất là wp-atmoving.cornships.com, nằm
# sau Basic Auth ở nginx; HQ không đi đường đó vì Application Password của
# WordPress cũng dùng header Authorization, hai lớp Basic Auth không chồng
# nhau được.
#
#   local 127.0.0.1:8090  ->  ssh  ->  VPS 127.0.0.1:8090
#
# CỔNG SOI GƯƠNG, khác hẳn scripts/db-tunnel.sh — và khác có lý do, không phải
# do quên.
#
# db-tunnel.sh cố tình dùng 55433 thay vì 5433 vì tồn tại HAI database: một
# trên máy này, một trên VPS. URL trùng số sẽ không phân biệt được, và đúng sự
# mơ hồ đó đã khiến một lần đặt mật khẩu quản trị vào database laptop trong
# khi mọi người tin là đã đặt lên server.
#
# Ở đây chỉ có MỘT WordPress. Không có bản local nào để nhầm, nên soi gương
# cổng là an toàn — và nó khiến wpApiBaseUrl lưu trong database
# (http://127.0.0.1:8090/wp-json/wp/v2) chạy nguyên vẹn ở cả hai nơi: trên VPS
# vì đó là loopback thật, trên máy này vì tunnel đưa đúng cổng ấy về.
#
# Nếu sau này có ai chạy một WordPress local ở 8090 thì sự mơ hồ xuất hiện —
# và ssh sẽ TỪ CHỐI mở (ExitOnForwardFailure) thay vì im lặng dùng cái sai.
#
# Dùng:
#   ./scripts/wp-tunnel.sh            # chạy nền trước, Ctrl-C để đóng
#   ./scripts/wp-tunnel.sh --ensure   # mở nền rồi thoát, dùng trong script

set -euo pipefail

# shellcheck source=scripts/tunnel-config.sh
source "$(dirname "${BASH_SOURCE[0]}")/tunnel-config.sh"
VPS_USER="$WP_SSH_USER"
LOCAL_PORT="$WP_LOCAL_PORT"
REMOTE_PORT="$WP_REMOTE_PORT"

tunnel_alive() {
  lsof -ti:"$LOCAL_PORT" >/dev/null 2>&1
}

wp_answers() {
  curl -s -m 5 -o /dev/null -w "%{http_code}" \
    "http://127.0.0.1:$LOCAL_PORT/wp-json/wp/v2/posts?per_page=1" 2>/dev/null | grep -q "^2"
}

PID_FILE="${TMPDIR:-/tmp}/pseo-wp-tunnel.pid"
LOG_FILE="${TMPDIR:-/tmp}/pseo-wp-tunnel.log"

# Vòng lặp nối lại. `|| code=$?` chứ KHÔNG phải gán ở dòng sau: với set -e, một
# lệnh thất bại sẽ giết cả script trước khi kịp đọc mã thoát, và vòng lặp thử
# lại chết lặng lẽ — đúng lỗi đã đo được ở db-tunnel.sh.
connect_loop() {
  while true; do
    code=0
    ssh -N \
      -o BatchMode=yes \
      -o ConnectTimeout=10 \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -i "$SSH_KEY" \
      -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
      "$VPS_USER@$VPS_HOST" || code=$?

    [[ $code -eq 0 ]] && { echo "Tunnel đóng."; break; }
    echo "Tunnel đứt (mã $code) — nối lại sau 4 giây..."
    sleep 4
  done
}

# --agent: chế độ dành cho launchd.
#
# Khác chế độ tiền cảnh ở một điểm quyết định: nó KHÔNG tranh cổng. Nếu đã có
# tunnel khác đang phục vụ (thường là cái predev mở), nó đứng chờ và kiểm lại
# mỗi 15 giây. Không có bước này thì ssh gặp ExitOnForwardFailure sẽ thoát
# ngay, KeepAlive dựng lại sau 10 giây, và hai bên quay vòng vô ích suốt thời
# gian máy bật — một "tự động" tốn pin mà không làm gì.
#
# Khi tunnel kia biến mất, vòng lặp này tiếp quản trong vòng 15 giây.
if [[ "${1:-}" == "--agent" ]]; then
  while true; do
    if wp_answers; then
      sleep 15
      continue
    fi
    connect_loop
    sleep 4
  done
fi

if [[ "${1:-}" == "--ensure" ]]; then
  if tunnel_alive; then
    # Cổng mở CHƯA CHẮC là tunnel còn sống: ssh có thể đã chết mà cổng vẫn bị
    # một tiến trình khác giữ. Hỏi thẳng WordPress thay vì tin vào cổng.
    if wp_answers; then
      echo "Tunnel WordPress đã mở sẵn ở cổng $LOCAL_PORT."
      exit 0
    fi
    echo "Cổng $LOCAL_PORT đang bị chiếm nhưng WordPress không trả lời."
    echo "Kiểm: lsof -ti:$LOCAL_PORT"
    exit 1
  fi

  # Dựng VÒNG LẶP ở nền, không phải một `ssh -f` trần.
  #
  # Đo 11/9/2026: bản trước dùng `ssh -f -N`, giết tiến trình ssh thì cổng
  # đóng và KHÔNG ai mở lại — nghĩa là máy ngủ dậy một lần là hỏng tới khi có
  # người gõ lệnh. db-tunnel.sh đã làm đúng từ trước; wp-tunnel.sh thì không,
  # và hai script cạnh nhau hành xử khác nhau là thứ không ai đoán ra.
  connect_loop >>"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"

  for _ in $(seq 1 15); do
    wp_answers && { echo "Tunnel WordPress đã mở ở cổng $LOCAL_PORT (tự nối lại khi đứt)."; exit 0; }
    sleep 1
  done
  echo "Mở tunnel rồi nhưng WordPress không trả lời trong 15 giây. Log: $LOG_FILE" >&2
  exit 1
fi

echo "127.0.0.1:$LOCAL_PORT  ->  $VPS_USER@$VPS_HOST  ->  127.0.0.1:$REMOTE_PORT"
echo "Ctrl-C để đóng."

connect_loop
