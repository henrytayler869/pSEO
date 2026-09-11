#!/usr/bin/env bash
# Sinh và nạp LaunchAgent mở tunnel ngay khi đăng nhập máy (macOS).
#
# Agent gọi THẲNG /usr/bin/ssh, không gọi script trong repo. Lý do đã đo
# 11/9/2026: repo nằm trong ~/Documents, và macOS TCC chặn launchd đọc thư mục
# đó — job thoát mã 126 với "Operation not permitted", KeepAlive dựng lại mỗi
# 10 giây, không lần nào chạy được. Cấp Full Disk Access cho bash để đi vòng
# là mở một quyền rộng hơn nhiều so với việc cần làm.
#
# ssh đọc khoá ở ~/.ssh, nơi TCC không chặn, nên nó chạy được.
#
# Tham số ssh sinh TỪ scripts/tunnel-config.sh chứ không gõ lại ở đây: có hai
# bản là có một bản sai vào lần đầu ai đó đổi VPS, và bản sai sẽ là bản chạy
# nền.
#
# Dùng:
#   ./scripts/install-tunnel-agents.sh            # sinh + nạp
#   ./scripts/install-tunnel-agents.sh --uninstall

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/tunnel-config.sh

AGENT_DIR="$HOME/Library/LaunchAgents"
LABELS=("com.pseo.db-tunnel" "com.pseo.wp-tunnel")

if [[ "${1:-}" == "--uninstall" ]]; then
  for label in "${LABELS[@]}"; do
    launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
    rm -f "$AGENT_DIR/$label.plist"
    echo "đã gỡ $label"
  done
  exit 0
fi

mkdir -p "$AGENT_DIR"

write_plist() {
  local label="$1" user="$2" local_port="$3" remote_port="$4"
  cat > "$AGENT_DIR/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string>
    <string>-N</string>
    <string>-o</string><string>BatchMode=yes</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-o</string><string>StrictHostKeyChecking=accept-new</string>
    <string>-i</string><string>$SSH_KEY</string>
    <string>-L</string><string>$local_port:127.0.0.1:$remote_port</string>
    <string>$user@$VPS_HOST</string>
  </array>
  <key>RunAtLoad</key><true/>
  <!-- KeepAlive thay cho vòng lặp trong script: ssh chết vì mất mạng hay máy
       ngủ thì launchd dựng lại. ThrottleInterval chặn quay vòng khi cổng đang
       bị tunnel của predev giữ — ssh thoát ngay vì ExitOnForwardFailure, và
       10 giây một lần là đủ thưa để không tốn gì. -->
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>/tmp/pseo-$label.log</string>
</dict>
</plist>
PLIST
  plutil -lint "$AGENT_DIR/$label.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_DIR/$label.plist"
  echo "đã nạp $label  ->  127.0.0.1:$local_port"
}

write_plist "com.pseo.db-tunnel" "$DB_SSH_USER" "$DB_LOCAL_PORT" "$DB_REMOTE_PORT"
write_plist "com.pseo.wp-tunnel" "$WP_SSH_USER" "$WP_LOCAL_PORT" "$WP_REMOTE_PORT"
