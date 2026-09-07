# Deploy: push lên `main` → tự động lên VPS

```
git push  →  GitHub Actions: migrate + typecheck + lint + build + test
                              ↓ (chỉ khi tất cả xanh)
                          scp bản đóng gói → VPS chạy deploy.sh
                              ↓
              releases/<sha>  →  đổi symlink  →  restart  →  kiểm tra sống
                              ↓ (nếu không sống)
                          tự quay lại bản trước
```

Deploy **không bao giờ chạy khi CI đỏ** — job `deploy` khai báo `needs: ci`.

---

## Phần bạn phải tự làm (tôi không được nhập hộ)

Đây là các bước **có bí mật**. Tôi không nhập key/mật khẩu vào bất kỳ đâu, kể cả
GitHub Secrets — bạn tự làm ba việc dưới.

### 1. Tạo cặp khoá SSH riêng cho deploy

Chạy **trên máy bạn** (không phải trên VPS):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/pseo_deploy -N "" -C "github-actions-deploy"
```

Đưa **nửa công khai** lên VPS:

```bash
ssh-copy-id -i ~/.ssh/pseo_deploy.pub pseo@<IP-VPS>
```

> Khoá này chỉ để deploy. Đừng dùng lại khoá cá nhân bạn vẫn đăng nhập —
> khoá nằm trong GitHub Secrets là khoá bạn phải coi như có thể lộ.

### 2. Lấy host key của VPS để ghim

```bash
ssh-keyscan -p 22 <IP-VPS>
```

Copy toàn bộ output. Đây là thứ chống MITM: pipeline **ghim** host key thay vì
"tin lần đầu gặp". Tin-lần-đầu trong CI nghĩa là một lần chạy trúng lúc bị
chen giữa sẽ tin kẻ tấn công cho mọi lần sau.

### 3. Thêm 4 secret vào GitHub

`github.com/henrytayler869/pSEO` → **Settings → Secrets and variables →
Actions → New repository secret**

| Tên | Giá trị |
|---|---|
| `VPS_HOST` | IP hoặc hostname VPS |
| `VPS_USER` | `pseo` |
| `VPS_SSH_KEY` | **toàn bộ** nội dung `~/.ssh/pseo_deploy` (nửa riêng tư, gồm cả dòng `-----BEGIN...`) |
| `VPS_KNOWN_HOSTS` | output của `ssh-keyscan` ở bước 2 |

`VPS_PORT` chỉ cần thêm nếu SSH không chạy cổng 22.

---

> **Trước khi thêm đủ 4 secret, job `deploy` sẽ ĐỎ.** Đó là cố ý. Tôi không
> cho nó tự bỏ qua khi thiếu secret, vì một job xanh-vì-không-làm-gì trông
> giống hệt một job xanh-vì-đã-deploy — và cả dự án này đã nhiều lần bị chính
> loại tín hiệu đó đánh lừa. Dấu đỏ ở đây có nghĩa rõ ràng: **chưa cấu hình
> xong**. Job `ci` vẫn chạy và vẫn phải xanh.

## Phần chuẩn bị VPS (một lần)

Session điều khiển VPS chạy các lệnh này. Cần Ubuntu/Debian, quyền sudo.

```bash
# Node 22 (Next 16 cần >= 20.9) + Docker
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs docker.io docker-compose-plugin

# User riêng cho app, không đăng nhập tương tác được
sudo useradd --system --create-home --shell /bin/bash pseo
sudo usermod -aG docker pseo

sudo mkdir -p /srv/pseo/{releases,shared}
sudo chown -R pseo:pseo /srv/pseo
```

**Postgres:**

```bash
sudo -u pseo cp deploy/docker-compose.prod.yml /srv/pseo/shared/
# Mật khẩu DB — bạn tự đặt, tôi không sinh hộ:
sudo -u pseo bash -c 'printf "%s" "<mật-khẩu-mạnh>" > /srv/pseo/shared/pg_password.txt'
sudo -u pseo chmod 600 /srv/pseo/shared/pg_password.txt
cd /srv/pseo/shared && sudo -u pseo docker compose -f docker-compose.prod.yml up -d
```

**`.env` — chỉ những gì cần TRƯỚC khi chạm được database:**

```bash
sudo -u pseo tee /srv/pseo/shared/.env > /dev/null <<'EOF'
DATABASE_URL=postgresql://pseo:<mật-khẩu-vừa-đặt>@127.0.0.1:5432/pseo_control_panel
NODE_ENV=production
EOF
sudo -u pseo chmod 600 /srv/pseo/shared/.env
```

> **Không** đặt `ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CENSUS_API_KEY`…
> vào đây. Chúng nằm trong database, nhập qua trang **Cài đặt**. Đó là lý do
> `deploy.sh` không bao giờ ghi `.env`: không có gì trong pipeline được phép
> đổi một bí mật.

**systemd + quyền restart không cần mật khẩu** (deploy.sh gọi `sudo systemctl restart`):

```bash
sudo cp deploy/pseo.service /etc/systemd/system/
echo 'pseo ALL=(root) NOPASSWD: /bin/systemctl restart pseo, /bin/systemctl status pseo' \
  | sudo tee /etc/sudoers.d/pseo-deploy
sudo chmod 440 /etc/sudoers.d/pseo-deploy
sudo systemctl daemon-reload && sudo systemctl enable pseo
```

> Dòng sudoers cố ý **liệt kê đúng hai lệnh**. `NOPASSWD: ALL` sẽ biến khoá
> deploy trong GitHub Secrets thành quyền root trên VPS.

**Nginx** (app chỉ nghe 127.0.0.1:3000, không có TLS riêng):

```nginx
server {
    listen 443 ssl;
    server_name <domain>;
    # ssl_certificate ... (certbot)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Lần deploy đầu

`deploy.sh` cần `current` trỏ đi đâu đó để có thể quay lại. Lần đầu chưa có —
script xử lý được (báo "không có bản trước") nhưng lần đầu nên chạy lúc bạn
đang nhìn màn hình.

Kiểm sau khi push:

```bash
sudo systemctl status pseo
readlink -f /srv/pseo/current          # phải là commit vừa push
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/v1/niches   # 401 = sống
```

`401` là **đúng**: gọi không kèm API key phải bị từ chối. Nó chứng minh Next
đang phục vụ, route khớp, và lớp xác thực có chạy — nhiều hơn những gì một
`200` ở trang chủ chứng minh được.

## Quay lại bản cũ bằng tay

```bash
ls -1dt /srv/pseo/releases/*/          # 5 bản gần nhất còn giữ
sudo -u pseo ln -sfnT /srv/pseo/releases/<sha-cũ> /srv/pseo/current
sudo systemctl restart pseo
```

Không build lại, không chạm database.

## Điều pipeline này KHÔNG làm

- **Không hoàn tác migration.** `prisma migrate deploy` chạy trước khi đổi
  symlink, nên migration hỏng thì bản cũ vẫn phục vụ và database không đổi.
  Nhưng nếu migration **thành công** rồi build hỏng, database đã tiến lên
  trong khi mã quay lại bản cũ. Migration phá vỡ tương thích ngược cần một
  bước triển khai riêng, không đẩy thẳng lên `main`.
- **Không chạy `test-ai-validator` hay `scan-generated-copy` trong CI.** Cả hai
  đối chiếu với **dữ liệu thật đã thu và văn bản thật đã sinh**, mà database CI
  thì trống. Chạy chúng trên database trống sẽ **báo xanh trong khi không kiểm
  gì** — đúng loại lỗi dự án này đã gặp nhiều lần. Chúng là lệnh chạy trên
  database thật, không phải cổng giả vờ.
- **Không thu thập dữ liệu.** Thu thập là việc có lịch riêng
  (`scripts/run-scheduled-collection.ts`), không gắn vào deploy.
