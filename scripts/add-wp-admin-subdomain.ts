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
//       --origin 46.225.145.196 --public-url https://atmovingservices.com [--apply]
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
# lại bằng thứ khác: nginx bắt mật khẩu TRƯỚC khi request chạm tới PHP. Máy
# quét gặp nginx, không gặp WordPress.
#
# Dùng CHUNG .htpasswd-pseo với Control Panel là lựa chọn của chủ dự án, đưa
# ra sau khi được nêu đánh đổi: một mật khẩu giữ cả hai hệ thống, lộ một cái
# là mất cả hai. Ghi lại ở đây để lần sau ai đọc biết đây là điều đã được cân
# nhắc, không phải điều bị bỏ sót.
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

function wpConfigExtra(host: string, port: string, publicUrl: string): string {
  return `      WORDPRESS_CONFIG_EXTRA: |
        // WP_HOME cố định, WP_SITEURL đổi theo lối vào. Hai hằng số này trả
        // lời hai câu hỏi khác nhau và đó là lý do chúng khác nhau ở đây:
        // WP_HOME là "bài viết sống ở đâu cho người đọc", WP_SITEURL là
        // "WordPress được truy cập ở đâu".
        //
        // Phiên bản đầu của đoạn này đặt CẢ HAI theo Host, và nó sai theo một
        // cách chỉ lộ ra rất muộn. Trình soạn thảo wp-admin ghi URL TUYỆT ĐỐI
        // vào post_content khi chèn ảnh, dựng từ WP_HOME tại thời điểm GHI.
        // Sửa WP_HOME theo request chỉ sửa đường ĐỌC; chuỗi đã nằm trong
        // database thì không được dựng lại.
        //
        // Publisher render post_content nguyên văn ra HTML công khai
        // (app/blog/[slug]/page.tsx: dangerouslySetInnerHTML với
        // post.content.rendered). Nên nếu soạn bài qua ${host},
        // mọi <img> công khai sẽ trỏ vào một host đòi Basic Auth. Còn nếu
        // WP_HOME là loopback — tức trạng thái HÔM NAY — chúng trỏ vào
        // 127.0.0.1 và cũng vỡ y hệt. Lỗi này có sẵn, không phải do subdomain
        // sinh ra; subdomain chỉ làm nó dễ bị chạm tới hơn.
        //
        // Để WP_HOME là tên miền công khai thì URL ghi vào database đúng ngay
        // từ đầu, và không cần sửa dữ liệu về sau. Đổi được an toàn vì đã đo:
        // publisher chỉ đọc content.rendered, không đọc "link" hay
        // "source_url" ở bất cứ đâu.
        //
        // Kèm theo: nginx của ${new URL(publicUrl).hostname} phải phục vụ
        // /wp-content/uploads/ (xem mục 3b), nếu không ảnh vẫn 404 — chỉ là
        // 404 ở đúng tên miền.
        define('WP_HOME', '${publicUrl}');
        if ((\$_SERVER['HTTP_HOST'] ?? '') === '${host}') {
            define('WP_SITEURL', 'https://${host}');
            // nginx kết thúc TLS; nếu không nói, WordPress tưởng là HTTP và
            // sinh link http:// bên trong một trang https://.
            \$_SERVER['HTTPS'] = 'on';
        } else {
            define('WP_SITEURL', 'http://127.0.0.1:${port}');
        }`;
}

/**
 * The uploads path on the PUBLIC site's vhost.
 *
 * Separate from the admin subdomain on purpose. Serving uploads from
 * wp-atmoving.cornships.com would also work, and would put the admin
 * hostname into the src of every image on every public page — advertising
 * the address of the login screen to everyone who reads the HTML, which is
 * the opposite of what the Basic Auth is for.
 */
function uploadsLocation(publicHost: string, port: string): string {
  return `# Thêm vào /etc/nginx/sites-available/${publicHost}, TRƯỚC "location /".
# ^~ để nó thắng mọi regex location khác.
#
# KHÔNG có Basic Auth: uploads là thứ sinh ra để công khai — <img> trên trang
# công khai không mang theo mật khẩu được. Đây không phải nới lỏng bảo mật;
# đây là đường mà ảnh của site LUÔN cần, kể cả khi không có subdomain admin.
#
# Chỉ /wp-content/uploads/, không phải cả /wp-content/: plugins và themes nằm
# cùng cây thư mục đó và không có lý do gì để ra ngoài.
location ^~ /wp-content/uploads/ {
    proxy_pass         http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-Proto $scheme;

    # Ảnh đã đăng thì không đổi; để trình duyệt và Cloudflare giữ.
    proxy_cache_valid  200 30d;
    add_header         Cache-Control "public, max-age=2592000" always;
}`;
}

async function main() {
  const host = arg("host");
  const origin = arg("origin");
  const port = arg("port") ?? "8090";
  const publicUrl = (arg("public-url") ?? "").replace(/\/+$/, "");
  const apply = process.argv.includes("--apply");

  if (!host || !origin || !publicUrl) {
    console.error("Thiếu tham số. Ví dụ:\n  tsx scripts/add-wp-admin-subdomain.ts --host wp-atmoving.cornships.com --origin 46.225.145.196 --public-url https://atmovingservices.com --apply");
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

  let publicHost = "";
  try {
    publicHost = new URL(publicUrl).hostname;
  } catch {
    console.error(`--public-url "${publicUrl}" không phải URL hợp lệ (cần dạng https://example.com).`);
    process.exitCode = 1;
    return;
  }

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
${wpConfigExtra(host, port, publicUrl)}

   rồi: docker compose up -d wordpress

3b) Đường công khai cho ảnh — BẮT BUỘC, không phải tuỳ chọn
${"-".repeat(78)}
${uploadsLocation(publicHost, port)}

   nginx -t && systemctl reload nginx

   Bỏ bước này thì mọi ảnh chèn qua wp-admin sẽ 404 trên trang công khai.
   Lỗi sẽ xuất hiện ở trang blog, không ở đây, và lần phát hiện sẽ là lần
   đầu có người đăng bài kèm ảnh.

4) Kiểm tra — bốn phép, và phép thứ tư là phép duy nhất chứng minh được
${"-".repeat(78)}
   # a) REST qua loopback vẫn 200, không bị canonical-redirect
   curl -s -o /dev/null -w 'REST loopback: %{http_code}\\n' \\
     http://127.0.0.1:${port}/wp-json/wp/v2/posts

   # b) subdomain: 401 khi chưa có mật khẩu. 200 nghĩa là Basic Auth KHÔNG dính.
   curl -s -o /dev/null -w 'wp-admin: %{http_code}\\n' https://${host}/wp-admin/

   # c) uploads trên tên miền công khai KHÔNG đòi mật khẩu
   #    (404 là đúng khi chưa có file — 401 mới là hỏng)
   curl -s -o /dev/null -w 'uploads: %{http_code}\\n' \\
     ${publicUrl}/wp-content/uploads/probe.jpg

   # d) PHÉP ĐO THẬT — cần một ảnh được tải lên QUA ${host}
   #    Ba phép trên không phân biệt được "đúng" với "chưa có dữ liệu để sai".
   #    Sau khi có ảnh, chuỗi trong post_content phải mang tên miền công khai:
   curl -s 'http://127.0.0.1:${port}/wp-json/wp/v2/posts?per_page=1&_fields=content' \\
     | grep -o 'src="[^"]*"'
   #    ĐẠT  : src="${publicUrl}/wp-content/uploads/...
   #    HỎNG : src="https://${host}/...   (ảnh sẽ đòi mật khẩu)
   #    HỎNG : src="http://127.0.0.1:${port}/...  (trạng thái cũ)
`);
}

main();
