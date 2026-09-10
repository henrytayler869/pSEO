// Creates the DNS record that gives a publisher's WordPress admin a browser
// address, and prints the two root-owned files it still needs.
//
// Split that way because the split is real: DNS is HQ's to change (it holds
// the Cloudflare token), while the nginx vhost, its certificate, and the
// container's WP_HOME belong to root on the VPS, which HQ's `deploy` account
// deliberately cannot touch — `sudo -l` there allows exactly four commands and
// none of them is nginx.
//
// So this script does its half and prints the other half verbatim rather than
// describing it. A handoff that says "add an nginx vhost proxying to 8090"
// is where the Host header, the ACME location, and the Basic Auth file get
// improvised differently every time.
//
// Usage:
//   tsx scripts/add-wp-admin-subdomain.ts --host wp-atmoving.cornships.com \
//       --origin 46.225.145.196 --port 8090 [--apply]
//
// Without --apply it prints what it would do and changes nothing.

import { getCredential } from "../lib/settings/credentials";
import { findCloudflareZoneByName } from "../lib/cloudflare/zones";
import { ensureDnsRecord } from "../lib/cloudflare/dns";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function nginxVhost(host: string, port: string): string {
  return `# ${host} — wp-admin cho WordPress đang nghe trên 127.0.0.1:${port}.
#
# Sinh bởi scripts/add-wp-admin-subdomain.ts. Đặt ở
# /etc/nginx/sites-available/${host} rồi symlink sang sites-enabled/.
#
# Vì sao có Basic Auth: docker-compose của WordPress ghi rõ lý do nó chỉ nghe
# loopback — "a public wp-admin is scanned continuously and has to be patched
# on someone else's schedule". Subdomain này làm yếu điều đó, nên nó phải trả
# lại bằng thứ khác: nginx bắt mật khẩu TRƯỚC khi request chạm tới PHP, dùng
# đúng file htpasswd mà HQ đang dùng. Máy quét gặp nginx, không gặp WordPress.
server {
    server_name ${host};

    access_log /var/log/nginx/${host}.access.log;
    error_log  /var/log/nginx/${host}.error.log;

    # wp-admin upload media; 25m khớp với vhost pseo.
    client_max_body_size 25m;

    add_header X-Frame-Options        "SAMEORIGIN"                      always;
    add_header X-Content-Type-Options "nosniff"                         always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;
    # Không để wp-admin lọt vào chỉ mục tìm kiếm dù có ai gỡ Basic Auth.
    add_header X-Robots-Tag           "noindex, nofollow"               always;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        auth_basic off;
    }

    # REST API KHÔNG mở ở đây. Publisher đọc WordPress qua loopback
    # (WP_API_BASE=http://localhost:${port}/wp-json/wp/v2) và không cần đường
    # công khai. Mở /wp-json ra ngoài chỉ thêm bề mặt tấn công cho một nhu cầu
    # không tồn tại.
    location /wp-json/ {
        return 404;
    }

    location / {
        auth_basic           "WordPress — AT Moving Services";
        auth_basic_user_file /etc/nginx/.htpasswd-pseo;

        proxy_pass         http://127.0.0.1:${port};
        proxy_http_version 1.1;
        # Host phải là ${host}, không phải 127.0.0.1:${port}: wp-config bên dưới
        # chọn WP_HOME dựa trên chính header này.
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    listen 80;
    listen [::]:80;
}
`;
}

function wpConfigExtra(host: string, port: string): string {
  return `      WORDPRESS_CONFIG_EXTRA: |
        // Hai lối vào, hai bộ URL — và đó là toàn bộ điểm của đoạn này.
        //
        // Publisher đọc REST qua loopback và nhận về URL tuyệt đối: một bài
        // viết trả link "http://127.0.0.1:${port}/hello-world/". Nếu đặt cứng
        // WP_HOME thành https://${host} thì dữ liệu publisher nhận được đổi
        // theo, và mọi URL đó trỏ vào một máy chủ có Basic Auth.
        //
        // Nên URL được chọn theo Host của request. Request qua loopback thấy
        // đúng những gì nó thấy hôm nay, không sai một byte. Chỉ trình duyệt
        // đi qua ${host} mới nhận bộ URL mới.
        if ((\$_SERVER['HTTP_HOST'] ?? '') === '${host}') {
            define('WP_HOME',    'https://${host}');
            define('WP_SITEURL', 'https://${host}');
            // nginx kết thúc TLS; nếu không nói, WordPress tưởng là HTTP và
            // sinh link http:// bên trong một trang https://.
            \$_SERVER['HTTPS'] = 'on';
        } else {
            define('WP_HOME',    'http://127.0.0.1:${port}');
            define('WP_SITEURL', 'http://127.0.0.1:${port}');
        }`;
}

async function main() {
  const host = arg("host");
  const origin = arg("origin");
  const port = arg("port") ?? "8090";
  const apply = process.argv.includes("--apply");

  if (!host || !origin) {
    console.error("Thiếu tham số. Ví dụ:\n  tsx scripts/add-wp-admin-subdomain.ts --host wp-atmoving.cornships.com --origin 46.225.145.196 --apply");
    process.exitCode = 1;
    return;
  }

  const parts = host.split(".");
  if (parts.length < 3) {
    console.error(`"${host}" không phải subdomain — cần dạng sub.domain.tld.`);
    process.exitCode = 1;
    return;
  }
  const zoneName = parts.slice(-2).join(".");

  const apiToken = await getCredential("CLOUDFLARE_API_TOKEN");
  if (!apiToken) {
    console.error("Chưa cấu hình CLOUDFLARE_API_TOKEN (trang Cài đặt).");
    process.exitCode = 1;
    return;
  }

  // Nếu bước dưới trả 403 (Cloudflare code 10000) ngay sau khi bạn vừa sửa
  // quyền token: ĐỢI, đừng đổi token.
  //
  // Đo 2026-09-10: sau khi thêm Zone→DNS→Edit, /dns_records trả 403 bốn lần
  // liên tiếp trong 45 giây rồi tự OK. Cửa sổ 45 giây đủ để kết luận "không
  // phải độ trễ lan quyền" một cách tự tin và sai, và kết luận đó dẫn thẳng
  // tới việc đi đổi sang một token khác vốn không cần đổi.
  //
  // Dấu hiệu phân biệt: 403 kèm zones:read vẫn OK nghĩa là token hợp lệ,
  // chỉ là phạm vi chưa tới. 401 mới là token sai.

  const zone = await findCloudflareZoneByName(zoneName, apiToken);
  if (!zone) {
    console.error(`Không tìm thấy zone "${zoneName}" trong tài khoản Cloudflare này.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Zone ${zoneName}: ${zone.id} (${zone.status})`);

  if (!apply) {
    console.log(`\nCHƯA CHẠY THẬT. Sẽ tạo A record ${host} -> ${origin} (proxied).`);
    console.log("Thêm --apply để thực hiện.\n");
  } else {
    const { record, created } = await ensureDnsRecord(zone.id, host, origin, apiToken, { proxied: true });
    if (created) {
      console.log(`\n✓ Đã tạo A ${record.name} -> ${record.content} (proxied: ${record.proxied})`);
    } else {
      console.log(`\n• Đã có sẵn: ${record.type} ${record.name} -> ${record.content} (proxied: ${record.proxied})`);
      if (record.content !== origin) {
        console.log(`  KHÁC với --origin ${origin}. Không tự sửa — một hostname đang sống trỏ đi đâu là do ai đó đã quyết định.`);
      }
    }
  }

  console.log(`
${"=".repeat(78)}
PHẦN CÒN LẠI CẦN ROOT TRÊN VPS — HQ (user deploy) không làm được.
${"=".repeat(78)}

1) /etc/nginx/sites-available/${host}
${"-".repeat(78)}
${nginxVhost(host, port)}
2) Bật site + xin chứng chỉ (certbot sẽ tự thêm block listen 443):
${"-".repeat(78)}
ln -s /etc/nginx/sites-available/${host} /etc/nginx/sites-enabled/${host}
nginx -t && systemctl reload nginx
certbot --nginx -d ${host}

   Nếu HTTP-01 thất bại vì Cloudflare proxy: tạm chuyển record sang DNS-only
   (mây xám), chạy lại certbot, rồi bật proxy lại.

3) /srv/atmovingservices/deploy/wordpress/docker-compose.yml
   Thay khối WORDPRESS_CONFIG_EXTRA hiện tại bằng:
${"-".repeat(78)}
${wpConfigExtra(host, port)}

   rồi: docker compose up -d wordpress

4) Kiểm tra — cả hai phải đúng, không chỉ cái thứ hai:
${"-".repeat(78)}
   # loopback KHÔNG đổi (publisher phụ thuộc vào điều này)
   curl -s http://127.0.0.1:${port}/wp-json/ | grep -o '"url":"[^"]*"'
   # phải vẫn là http://127.0.0.1:${port}

   # trình duyệt qua subdomain: 401 khi chưa có mật khẩu, không phải 200
   curl -s -o /dev/null -w '%{http_code}\\n' https://${host}/wp-admin/
`);
}

main();
