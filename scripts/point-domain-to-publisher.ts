// Trỏ một domain đã có zone Cloudflare về máy chủ publisher.
//
// Bước còn thiếu giữa "đã thêm domain" và "site chạy được": add-domain.ts chỉ
// tạo/nhận zone, nó KHÔNG tạo record nào. Một zone active mà không có A record
// vẫn hiện "hoạt động" ở mọi chỗ nhìn được — Cloudflare xanh, NS đúng — và
// domain đơn giản là không phân giải. Đó chính là thứ đã làm publisher thứ hai
// đứng im, trong khi tôi đi tìm nguyên nhân ở Google Cloud Console.
//
//   tsx scripts/point-domain-to-publisher.ts --name <domain> --ip <ip> [--proxied]
//
// VÌ SAO MẶC ĐỊNH LÀ KHÔNG PROXY, DÙ ĐÍCH ĐẾN LÀ CÓ PROXY
//
// Với đám mây cam và SSL mode Full, Cloudflare nối về origin bằng HTTPS. Origin
// chưa có chứng chỉ cho host mới nên bắt tay TLS bị từ chối, và thử thách
// HTTP-01 của certbot thất bại — nhưng thất bại ở tầng edge, với thông báo nói
// về challenge chứ không nói về SSL mode. Nên: xám → lấy cert → bật cam.
//
// --proxied là bước BẬT CAM đó. Nó chỉ đổi đúng cờ proxied, và TỪ CHỐI khi
// record đang trỏ tới IP khác — đổi chỗ một hostname đang sống là việc phải do
// người quyết, không phải hệ quả phụ của một lệnh đi bật cache.

import { prisma } from "../lib/db/prisma";
import { getCredential } from "../lib/settings/credentials";
import { ensureDnsRecord, findDnsRecord } from "../lib/cloudflare/dns";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function setProxied(zoneId: string, recordId: string, token: string, proxied: boolean) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ proxied }),
  });
  const j = (await res.json()) as { success: boolean; errors?: unknown[] };
  if (!j.success) throw new Error(`Cloudflare từ chối PATCH (HTTP ${res.status}): ${JSON.stringify(j.errors).slice(0, 200)}`);
}

async function main() {
  const name = arg("--name")?.trim().toLowerCase();
  const ip = arg("--ip")?.trim();
  const wantProxied = process.argv.includes("--proxied");
  if (!name || !ip) {
    console.error("Cần --name <domain> và --ip <ip>. Thêm --proxied để bật đám mây cam SAU khi đã có chứng chỉ.");
    process.exit(1);
  }

  const token = await getCredential("CLOUDFLARE_API_TOKEN");
  if (!token) {
    console.error("Chưa có CLOUDFLARE_API_TOKEN trong Cài đặt.");
    process.exit(1);
  }

  const domain = await prisma.domain.findFirst({ where: { name }, select: { cloudflareZoneId: true } });
  if (!domain?.cloudflareZoneId) {
    console.error(`Domain "${name}" chưa có zone Cloudflare trong HQ. Chạy scripts/add-domain.ts trước.`);
    process.exit(1);
  }
  const zoneId = domain.cloudflareZoneId;

  // apex và www cùng lúc: một site trả lời ở apex mà không trả lời ở www là
  // lỗi chỉ lộ ra khi ai đó gõ www, tức là sau khi đã tin là xong.
  for (const host of [name, `www.${name}`]) {
    const { record, created } = await ensureDnsRecord(zoneId, host, ip, token, { type: "A", proxied: false });

    if (!created && record.content !== ip) {
      console.log(`  ${host.padEnd(34)} ĐANG TRỎ ${record.content} — KHÔNG đụng tới. Sửa tay nếu thật sự muốn đổi.`);
      continue;
    }
    console.log(`  ${host.padEnd(34)} A ${ip}  ${created ? "đã tạo" : "đã có"}  proxied=${record.proxied}`);

    if (wantProxied && !record.proxied) {
      const fresh = await findDnsRecord(zoneId, host, "A", token);
      if (!fresh) throw new Error(`Vừa thấy ${host} nhưng đọc lại không có — schema drift.`);
      await setProxied(zoneId, fresh.id, token, true);
      console.log(`  ${host.padEnd(34)} → đã bật proxy (đám mây cam)`);
    }
  }

  console.log(
    wantProxied
      ? "\nKiểm lại: `dig +short <domain>` phải ra IP của Cloudflare, KHÔNG phải IP máy chủ."
      : "\nChưa proxy (đám mây xám) — `dig +short <domain>` phải ra đúng IP máy chủ. Lấy chứng chỉ xong thì chạy lại kèm --proxied."
  );
}

void main().finally(() => prisma.$disconnect());
