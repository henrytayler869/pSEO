# Deploy: push lên `main` → tự động lên VPS

```
git push  →  GitHub Actions: npm ci · migrate lên DB trắng · build · typecheck
                             · lint · test luật xác thực
                              ↓ (chỉ khi tất cả xanh)
              ssh vào VPS, stream deploy.sh
                              ↓
     git reset --hard <sha> · npm ci · migrate · build · restart · kiểm sống
                              ↓ (nếu không sống)
                     tự quay lại commit trước
```

Deploy **không bao giờ chạy khi CI đỏ** — job `deploy` khai báo `needs: ci`.

---

## Máy đích (đọc từ máy thật, 2026-09-07)

Tài liệu này mô tả **máy đang có**, không phải máy mà repo mong muốn. VPS được
dựng trước khi có thư mục `deploy/`, và **máy mới là bên có thẩm quyền** —
`deploy.sh` viết lại cho khớp nó, không phải ngược lại.

| | |
|---|---|
| Máy | Hetzner CPX32 · Ubuntu 26.04.1 LTS · 4 vCPU · 7,6 GiB RAM |
| Mã nguồn | `/opt/pseo` — **git checkout thường, cập nhật tại chỗ**. Không có `releases/` + symlink `current` |
| User | `deploy` (uid 1000) chạy service và sở hữu checkout. **Không có user `pseo`** |
| Kéo mã | Deploy key GitHub **read-only** sẵn trên máy; `git pull` chạy được dưới `deploy` |
| `.env` | `/opt/pseo/.env`, 0600 — **Next tự load**, systemd KHÔNG đọc |
| Postgres | Docker, `127.0.0.1:5433`, đã đóng với internet |
| Nginx | `hq.cornships.com` → `127.0.0.1:3000`. Basic Auth ở `/`, **tắt ở `/api/v1/`** |
| Node / npm | v22.23.2 / **11.6.2 (đã pin)** |

### Ba điều đừng "sửa cho gọn"

**Đừng thêm `EnvironmentFile=/opt/pseo/.env` vào unit.** Next đã tự load file
đó từ working directory. systemd parse quote theo luật khác dotenv, nên trỏ
systemd vào cùng file nghĩa là load hai lần theo hai bộ luật. Script chạy ngoài
Next (`tsx`) phải tự load dotenv.

**Đừng bật Basic Auth cho `/api/v1/`.** Site Pubsite gọi vào đó bằng
`X-Api-Key`. Bắt Basic Auth ở đấy sẽ làm site mất toàn bộ dữ liệu và 127 trang
mất đoạn diễn giải. `/api/v1` **có** lớp xác thực riêng trong code
(`requireApiKey`, so sánh timing-safe, một key tại một thời điểm) — chỉ giao
diện UI mới dựa vào Basic Auth.

**Đừng đưa user `deploy` vào group `docker`.** Group docker tương đương root:
ai vào được cũng mount rootfs của host vào container rồi thành root, và dòng
sudoers hẹp bên dưới thành vô nghĩa. Postgres container có
`restart: unless-stopped` nên tự lên theo dockerd — deploy không cần quyền
docker.

### Quyền của user deploy

```
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart pseo,
                            /usr/bin/systemctl status pseo,
                            /usr/bin/systemctl is-active pseo
```

Đúng ba lệnh. Khoá deploy nằm trong GitHub Secrets nên phải coi như có thể lộ —
`NOPASSWD: ALL` sẽ biến một secret thành quyền root trên máy.

---

## Phần bạn phải tự làm (tôi không nhập hộ)

### ⚠️ Khoá SSH: KHÔNG dùng khoá cá nhân

`authorized_keys` của `deploy` hiện đang chứa **khoá cá nhân của bạn** (copy từ
root lúc provision). **Đừng đưa khoá đó vào GitHub Secrets** — nó mở được cả
những thứ khác của bạn, và một secret CI là thứ phải coi như sẽ lộ.

Cần một cặp khoá **chỉ dùng cho CI**, và chỉ nửa công khai của nó vào
`authorized_keys` của `deploy`.

### 4 secret cần có

| Tên | Giá trị |
|---|---|
| `VPS_HOST` | `46.225.145.196` |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | nửa **riêng tư** của cặp khoá CI mới |
| `VPS_KNOWN_HOSTS` | output `ssh-keyscan -p 22 46.225.145.196` |

`VPS_PORT` chỉ cần nếu SSH không ở cổng 22.

> **Trước khi có đủ 4 secret, job `deploy` sẽ ĐỎ.** Cố ý. Một job
> xanh-vì-không-làm-gì trông giống hệt job xanh-vì-đã-deploy, và dự án này đã
> nhiều lần bị chính loại tín hiệu đó đánh lừa. Đỏ ở đây nghĩa là **chưa cấu
> hình xong**; job `ci` vẫn phải xanh.

---

## `deploy.sh` làm gì, và cố ý KHÔNG làm gì

```
git fetch --prune origin
git reset --hard <sha>        # KHÔNG phải origin/main: đúng commit CI đã kiểm
npm ci
npx prisma migrate deploy     # app cũ vẫn đang phục vụ
npx prisma generate
npm run build
sudo systemctl restart pseo
curl 127.0.0.1:3000/api/v1/niches   # phải 401 + đúng thông điệp của app
```

Reset theo **SHA** chứ không theo `origin/main`: một push khác có thể rơi vào
giữa lúc deploy đang chạy, và `origin/main` sẽ lặng lẽ đưa lên máy một commit
chưa cổng nào kiểm.

**Không bao giờ `git clean -fdx`.** `/opt/pseo` có hai file untracked bắt buộc
giữ: `.env`, và `docker-compose.override.yml` (chứa mật khẩu database thật).
Clean sẽ xoá cả hai — chết app và mất mật khẩu. `git reset --hard` không đụng
file untracked, đó là lý do dùng nó.

**Health check không chỉ đọc mã 401.** Nó đòi thân phản hồi mang đúng thông
điệp xác thực của app. Mã 401 không cho biết **ai** trả lời: một process cũ
chưa tắt, một dev server bỏ quên, bất cứ thứ gì đang giữ cổng 3000 đều trả 401
được, và deploy sẽ ghi "sống" trong khi bản vừa cài chưa chạy. Đã thử hai
chiều: app thật → đạt; server khác trả `401` HTML rỗng cùng cổng → trượt.

Check gọi thẳng `127.0.0.1:3000`, **đi vòng qua Nginx** — nó trả lời "bản này
có phục vụ không", không phải "cổng vào công khai có sống không".

### Cửa sổ rủi ro của deploy tại chỗ

Vì cập nhật tại chỗ chứ không đổi symlink, có một khoảng **giữa lúc build xong
và lúc restart**: `.next` trên đĩa là mã mới trong khi process trong bộ nhớ là
mã cũ. Next có thể lazy-load chunk lúc chạy, nên request rơi vào khoảng đó có
thể gặp lệch. Trên máy này build đo được **12,6 giây**, restart ~5 giây, và đây
là công cụ nội bộ — nên khoảng đó được **chấp nhận có ý thức**, không phải bị
bỏ sót. Muốn bỏ hẳn thì phải chạy cổng thứ hai và switch ở Nginx.

### Quay lại bản cũ

Tự động khi `npm ci` hỏng, build hỏng, hoặc health check trượt. Bằng tay:

```bash
cd /opt/pseo
git reset --hard <sha-cũ>
npm ci && npx prisma generate && npm run build
sudo systemctl restart pseo
```

Chậm hơn đổi symlink vì phải build lại — cái giá của layout tại chỗ.

---

## Điều pipeline này KHÔNG làm

- **Không hoàn tác migration.** `migrate deploy` chạy trước build, nên
  migration hỏng thì database không đổi và app cũ vẫn phục vụ. Nhưng nếu
  migration **thành công** rồi build hỏng, database đã tiến lên trong khi mã
  quay về commit cũ. Migration phá vỡ tương thích ngược cần bước triển khai
  riêng, không đẩy thẳng lên `main`.
- **Không chạy `test-ai-validator` hay `scan-generated-copy` trong CI.** Cả hai
  đối chiếu với dữ liệu thật đã thu và văn bản thật đã sinh; database CI trống.
  Chạy chúng ở đó sẽ **báo xanh trong khi không kiểm gì** — đúng loại lỗi dự án
  này gặp nhiều lần. Chúng là lệnh chạy trên database thật, không phải cổng giả
  vờ.
- **Không thu thập dữ liệu.** Thu thập có lịch riêng
  (`scripts/run-scheduled-collection.ts`).
- **Không cấp TLS.** `cornships.com` đang chuyển nameserver sang Cloudflare;
  Let's Encrypt cấp sau khi DNS về.
