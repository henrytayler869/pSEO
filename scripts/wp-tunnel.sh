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
# Ở đây không có WordPress bản local nào để nhầm, nên soi gương cổng là an
# toàn — và nó khiến wpApiBaseUrl lưu trong database
# (http://127.0.0.1:8091/wp-json/wp/v2) chạy nguyên vẹn ở cả hai nơi: trên VPS
# vì đó là loopback thật, trên máy này vì tunnel đưa đúng cổng ấy về.
#
# NHIỀU WORDPRESS, VÀ DANH SÁCH CỔNG KHÔNG VIẾT CỨNG.
#
# Đoạn này từng ghi "Ở đây chỉ có MỘT WordPress". Câu đó đúng cho tới ngày
# 19/9/2026, khi publisher thứ hai được cấp WordPress riêng ở cổng 8091 —
# và script vẫn chỉ chuyển tiếp 8090. Hậu quả hiện thẳng trên màn hình
# Control Panel:
#
#   http://127.0.0.1:8091/wp-json/wp/v2 — fetch failed
#
# Cổng giờ HỎI MÁY CHỦ chứ không đọc một hằng số: mọi container tên *-wp đang
# nghe cổng nào thì chuyển tiếp đúng cổng đó. Publisher thứ ba sẽ tự có tunnel
# mà không ai phải sửa file này — và một danh sách cứng thì đúng vào ngày viết
# ra rồi sai lặng lẽ sau đó.
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

# Cổng của MỌI WordPress đang chạy trên VPS, hỏi thẳng docker.
#
# Hỏng đường mạng thì rơi về cổng mặc định thay vì bỏ trống: một tunnel thiếu
# còn dùng được một nửa, còn không mở tunnel nào thì hỏng hoàn toàn.
discover_ports() {
  local found
  found=$(ssh -o BatchMode=yes -o ConnectTimeout=8 -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" \
    "docker ps --filter name=-wp --format '{{.Ports}}' | grep -oE '127\\.0\\.0\\.1:[0-9]+' | cut -d: -f2 | sort -u" 2>/dev/null || true)
  if [[ -z "$found" ]]; then
    echo "$WP_LOCAL_PORT"
    return
  fi
  echo "$found"
}

PORTS=$(discover_ports)
# shellcheck disable=SC2206
PORT_LIST=($PORTS)
LOCAL_PORT="${PORT_LIST[0]}"

# Cổng nào ĐÃ có người phục vụ thì không tranh.
#
# ssh chạy với ExitOnForwardFailure=yes, nên xin một cổng đang bận làm HỎNG CẢ
# LƯỢT — kể cả những cổng còn trống. Đo 19/9/2026: một tunnel cũ giữ 8090, và
# lần mở mới cho {8090, 8091} thất bại hoàn toàn, để 8091 không có đường trong
# khi nó mới là cổng đang thiếu.
#
# Bỏ qua chứ không giết tunnel cũ: cái đang chạy có thể là của launchd hoặc
# của một phiên khác, và giết nó là sửa triệu chứng của mình bằng cách gây
# triệu chứng cho người khác.
serves() {
  curl -s -m 3 -o /dev/null -w "%{http_code}" \
    "http://127.0.0.1:$1/wp-json/wp/v2/posts?per_page=1" 2>/dev/null | grep -q "^2"
}

NEEDED=()
for _p in "${PORT_LIST[@]}"; do
  if serves "$_p"; then
    echo "Cổng $_p đã có WordPress trả lời — bỏ qua."
  else
    NEEDED+=("$_p")
  fi
done

tunnel_alive() {
  # Sống = MỌI cổng đều đã mở. Một cổng mở còn cổng kia chưa vẫn là hỏng, và
  # kiểm mỗi cổng đầu sẽ báo "đang chạy" cho một tunnel thiếu một nửa.
  local p
  for p in "${PORT_LIST[@]}"; do
    lsof -ti:"$p" >/dev/null 2>&1 || return 1
  done
  return 0
}

wp_answers() {
  local p
  for p in "${PORT_LIST[@]}"; do
    curl -s -m 5 -o /dev/null -w "%{http_code}" \
      "http://127.0.0.1:$p/wp-json/wp/v2/posts?per_page=1" 2>/dev/null | grep -q "^2" || return 1
  done
  return 0
}

PID_FILE="${TMPDIR:-/tmp}/pseo-wp-tunnel.pid"
LOG_FILE="${TMPDIR:-/tmp}/pseo-wp-tunnel.log"

# Vòng lặp nối lại. `|| code=$?` chứ KHÔNG phải gán ở dòng sau: với set -e, một
# lệnh thất bại sẽ giết cả script trước khi kịp đọc mã thoát, và vòng lặp thử
# lại chết lặng lẽ — đúng lỗi đã đo được ở db-tunnel.sh.
# Một cờ -L cho mỗi cổng. Soi gương cổng: cổng local = cổng trên VPS, nên
# wpApiBaseUrl trong database chạy nguyên ở cả hai nơi.
FORWARDS=()
for _p in "${NEEDED[@]}"; do
  FORWARDS+=(-L "$_p:127.0.0.1:$_p")
done

if [[ ${#FORWARDS[@]} -eq 0 ]]; then
  echo "Mọi WordPress (${PORT_LIST[*]}) đã có đường — không cần mở thêm."
  exit 0
fi
echo "Sẽ mở: ${NEEDED[*]}"

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
      "${FORWARDS[@]}" \
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
      echo "Tunnel WordPress đã mở sẵn: ${PORT_LIST[*]}."
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
    wp_answers && { echo "Tunnel WordPress đã mở: ${NEEDED[*]} (đang phục vụ: ${PORT_LIST[*]}) (tự nối lại khi đứt)."; exit 0; }
    sleep 1
  done
  echo "Mở tunnel rồi nhưng WordPress không trả lời trong 15 giây. Log: $LOG_FILE" >&2
  exit 1
fi

echo "127.0.0.1:$LOCAL_PORT  ->  $VPS_USER@$VPS_HOST  ->  127.0.0.1:$REMOTE_PORT"
echo "Ctrl-C để đóng."

connect_loop
