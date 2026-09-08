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

## Dùng CHUNG database với production (từ máy dev)

```bash
npm run db:tunnel     # giữ terminal này mở
```

Cửa sổ khác:

```bash
npm run db:which      # LUÔN chạy trước khi làm gì
```

`.env` ở máy dev đổi cổng `5433` → `55433`:

```
DATABASE_URL="postgresql://pseo:<mật-khẩu-production>@127.0.0.1:55433/pseo_control_panel?schema=public"
```

Mật khẩu đọc từ `/opt/pseo/.env` trên VPS. **Tôi không lấy hộ và không nên có ai
gửi nó qua chat** — bạn tự đọc, tự dán.

### Vì sao cổng 55433 chứ không phải 5433

Production Postgres cũng nghe **5433** trên loopback của nó. Tunnel về đúng số
đó thì hai `DATABASE_URL` **giống hệt nhau về mặt chữ** — `127.0.0.1:5433` ở cả
hai — và không còn cách nào nhìn URL mà biết lệnh sắp ghi vào đâu.

Đúng sự mơ hồ đó đã tốn của dự án này một lần: mật khẩu quản trị được đặt vào
database trên laptop trong khi mọi người tin nó đã lên server, và **không có gì
trong output phân biệt hai nơi**. Một số cổng khác nhau là thứ rẻ nhất mua được
sự phân biệt đó.

`lib/db/prisma.ts` cũng in cảnh báo một lần mỗi tiến trình khi thấy `:55433`.

### ⚠️ Ba lệnh không bao giờ được chạy khi tunnel đang mở

```
prisma migrate dev     ← xoá sạch rồi dựng lại database
prisma migrate reset   ← như trên
prisma db push         ← đổi schema không qua migration, không để lại dấu vết
```

Đổi schema ở production **chỉ đi một đường**: viết migration → push → CI áp lên
DB trắng để kiểm → `migrate deploy` trên VPS, sau khi backup đã chụp.

### Cái giá của việc dùng chung, nói thẳng

- **Mọi script chạy ở local ghi vào dữ liệu thật.** Không có bản nháp. Trong
  chính dự án này đã có hai lần thao tác đi nhầm chỗ (`git clean -fdx` xoá
  `.env`, và mật khẩu đặt nhầm máy) — với DB chung, cả hai đã đánh vào production.
- **Thử nghiệm tốn tiền thật.** Sinh nội dung AI ăn vào cùng một trần; chạy
  keyword research ăn vào cùng tài khoản DataForSEO.
- **Mất tunnel là mất khả năng làm việc.** Không SSH được thì không có database.
- Container Postgres trên máy dev vẫn còn nguyên ở cổng 5433 — đổi `.env` về
  `5433` là quay lại làm việc offline, dữ liệu cũ vẫn đó.

---

## `deploy.sh` làm gì, và cố ý KHÔNG làm gì

```
git fetch --prune origin
git reset --hard <sha>        # KHÔNG phải origin/main: đúng commit CI đã kiểm
npm ci
sudo -n pseo-db-backup.sh     # HỎNG => dừng, chưa đụng database
npx prisma migrate deploy     # app cũ vẫn đang phục vụ
npx prisma generate
npm run build
sudo systemctl restart pseo
curl 127.0.0.1:3000/api/v1/niches   # phải 401 + đúng thông điệp của app
```

**Vì sao chụp backup ngay trước migrate:** rollback bên dưới đảo được **mã
nguồn**, không đảo được **dữ liệu**. `migrate deploy` chạy trước build, nên một
migration phá dữ liệu vẫn để lại hậu quả sau khi checkout đã lùi về commit cũ —
máy trở lại xanh trong khi dữ liệu thì không. Backup hàng đêm (03:17) phủ được
chuyện đó về lâu dài; cái này phủ mấy phút đáng kể.

Chụp ở **mọi lần deploy**, không chỉ khi có migration chờ. Xét "có migration
nào không" là đặt một phán đoán có thể sai ngay trước thứ dùng để phòng khi
phán đoán sai — mà một dump của database này tốn khoảng một giây và dưới một
megabyte.

Quyền cần thiết (đúng một dòng, không tham số):

```
deploy ALL=(root) NOPASSWD: /usr/local/bin/pseo-db-backup.sh
```

Script phải `root:root`, **và không thư mục cha nào trên đường dẫn ghi được bởi
`deploy`**. Nếu `deploy` sửa được nội dung script — hoặc thay được file, hoặc
bất kỳ thư mục cha nào — thì dòng trên **tương đương `NOPASSWD: ALL`**: ghi
`chmod u+s /bin/bash` vào script rồi gọi sudo là xong. Đã kiểm trên máy: script
`700 root:root`, mọi thành phần đường dẫn `root:root`, `deploy` không ghi được
thành phần nào.

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
- **Không lọc access log, và hiện không cần.** Nginx ghi log `combined`, tức là
  **có ghi query string**, giữ 14 ngày, nén. Đã kiểm 2026-09-07: không dòng nào
  chứa key/token/pass/secret. Lý do là cấu trúc chứ không phải may — credential
  chỉ được đọc từ **header** (`lib/api/auth.ts`: `authorization` và
  `x-api-key`), không route nào dưới `app/api/v1` đọc nó từ `searchParams`, và
  các tham số query đang dùng đều vô hại (`generate`, `cachedOnly`, `import`,
  `older`, `newer`, `tab`).

  > **Cam kết đứng:** nếu về sau có endpoint nào nhận **tham số nhạy cảm qua
  > query**, phải báo session điều khiển VPS để họ thêm lọc — lúc đó việc lọc
  > mới có mục tiêu cụ thể. Thêm quy tắc lọc lúc bề mặt đang sạch thì tệ hơn là
  > không có: nó tạo cảm giác an toàn cho thứ nó không thật sự bao phủ.
  >
  > Đây cũng là lý do middleware chỉ mang `pathname` vào tham số `next` của
  > trang đăng nhập và **bỏ query string** — thứ gì rơi vào access log thì nằm
  > im ở đó 14 ngày, và không ai đọc lại.

- **Không đụng tới Nginx, và không được đụng.** TLS do certbot quản (tự gia
  hạn, `certbot.timer`). Đặc biệt **đừng ghi đè
  `/etc/nginx/sites-available/00-default-drop`**: certbot thêm block `443` vào
  file site chính, khiến chốt chặn "request tới IP trần" chỉ còn hiệu lực ở
  cổng 80 — nếu không có default_server 443 với `ssl_reject_handshake on` thì
  gõ thẳng IP qua https sẽ rơi vào block duy nhất có 443 và **phục vụ Control
  Panel cho cả internet**. Chốt đó do session VPS dựng, nằm ngoài repo này.
