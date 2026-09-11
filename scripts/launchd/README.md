# Mở tunnel tự động khi đăng nhập máy (macOS)

`npm run dev` đã tự mở cả hai tunnel ở bước `predev`, và mỗi tunnel tự nối
lại khi đứt (đo 11/9/2026: giết ssh bằng -9, tunnel WordPress sống lại sau 14
giây). Cái còn thiếu là lúc **máy vừa khởi động và bạn chưa chạy lệnh nào** —
lúc đó chưa có tiến trình nào để tự lành.

Hai file `.plist` ở thư mục này giao việc đó cho `launchd`: nó chạy tunnel
ngay khi bạn đăng nhập, và `KeepAlive` dựng lại nếu cả script chết.

## Nạp

```bash
cp scripts/launchd/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pseo.db-tunnel.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pseo.wp-tunnel.plist
```

## Gỡ

```bash
launchctl bootout gui/$(id -u)/com.pseo.db-tunnel
launchctl bootout gui/$(id -u)/com.pseo.wp-tunnel
rm ~/Library/LaunchAgents/com.pseo.*-tunnel.plist
```

## Cần biết trước khi nạp

- Đây là **cấu hình thường trú** trên máy bạn: tunnel mở mỗi lần đăng nhập,
  kể cả khi bạn không định làm việc với dự án này. Tunnel DB nối thẳng vào
  **database production**.
- Đường dẫn repo được ghi cứng trong plist (`/Users/user/Documents/pseo-control-panel`). Đổi chỗ repo thì phải
  sinh lại file.
- Log: `/tmp/pseo-db-tunnel.log` và `/tmp/pseo-wp-tunnel.log`.
