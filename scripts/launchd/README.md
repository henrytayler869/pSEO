# Tunnel tự mở khi đăng nhập máy (macOS)

```bash
./scripts/install-tunnel-agents.sh              # sinh + nạp
./scripts/install-tunnel-agents.sh --uninstall  # gỡ hẳn
```

## Vì sao agent gọi thẳng `ssh` chứ không gọi script trong repo

Đo 11/9/2026: bản đầu trỏ plist vào `scripts/wp-tunnel.sh`. Job thoát **mã
126**, log ghi `Operation not permitted` khi chỉ mới `getcwd`. Nguyên nhân là
TCC của macOS — launchd không được vào `~/Documents`, nơi repo đang nằm.

Cách đi vòng là cấp Full Disk Access cho `bash`, tức mở một quyền rộng hơn
nhiều so với việc cần làm. Thay vào đó agent chạy `/usr/bin/ssh` với tham số
sinh sẵn; `ssh` chỉ đọc khoá ở `~/.ssh`, nơi TCC không chặn.

Tham số sinh **từ `scripts/tunnel-config.sh`**, không gõ lại trong plist: có
hai bản là có một bản sai vào lần đầu ai đó đổi VPS — và bản sai sẽ là bản
chạy nền, thứ không ai nhìn.

## Đã đo

Giết cả hai tiến trình ssh: launchd dựng lại nhanh tới mức phép kiểm ngay sau
đó đã thấy cả DB lẫn WordPress thông. Không gõ lệnh nào.

## Quan hệ với `predev`

`npm run dev` vẫn chạy `--ensure` cho cả hai tunnel, nhưng khi agent đang giữ
cổng thì `--ensure` thấy dịch vụ trả lời và **không làm gì**. Hai lớp không
tranh nhau.

## Dừng

`npm run wp:tunnel:stop` giết tiến trình ssh, nhưng **launchd sẽ dựng lại
trong ~10 giây**. Muốn tắt hẳn thì gỡ agent:

```bash
./scripts/install-tunnel-agents.sh --uninstall
```

## Cần biết

- Đây là **cấu hình thường trú**: tunnel mở mỗi lần đăng nhập, kể cả khi bạn
  không làm việc với dự án này. Tunnel DB nối thẳng vào **database
  production**.
- Đổi chỗ repo hay đổi VPS thì chạy lại trình cài để sinh plist mới.
- Log: `/tmp/pseo-com.pseo.db-tunnel.log`, `/tmp/pseo-com.pseo.wp-tunnel.log`.
