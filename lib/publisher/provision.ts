import { prisma } from "@/lib/db/prisma";
import { checkReadiness } from "@/lib/publisher/readiness";
import { getCredential } from "@/lib/settings/credentials";
import { ensureDnsRecord, findDnsRecord } from "@/lib/cloudflare/dns";
import { createPropertyWithWebStream, listAccounts, AnalyticsAdminError } from "@/lib/google/analytics-admin";
import { createPublisherKey } from "@/lib/settings/api-key";
import { pushKeyToSite } from "@/lib/publisher/push-key";
import { writeSiteToRepo } from "@/lib/publisher/repo-write";
import { specFor } from "@/lib/content-spec/niche-spec";

/**
 * "Dựng Site": chạy những bước HQ THẬT SỰ làm được, và nói rõ những bước
 * không làm được.
 *
 * ═══ VÌ SAO KHÔNG PHẢI MỘT NÚT LÀM TẤT ═══
 *
 * Dựng publisher thứ hai ngày 17–18/9/2026 mất chín bước. Sáu bước nằm trong
 * tầm HQ; ba bước không:
 *
 *   khối nginx cho host mới      ssh vào VPS
 *   chứng chỉ Let's Encrypt      certbot trên VPS
 *   sites.json + manifest + deploy   repo publisher, qua PR
 *
 * Ba bước đó KHÔNG được giả vờ. Một nút báo "đã dựng xong" trong khi nginx
 * chưa có host nào sẽ tạo ra đúng loại niềm tin sai mà cả dự án này chống.
 *
 * ═══ VÀ THỨ TỰ CÓ PHỤ THUỘC, NÊN NÚT PHẢI CHẠY ĐƯỢC NHIỀU LẦN ═══
 *
 * Đẩy khoá cần host trả lời được → cần nginx + cert → là bước tay. Bật proxy
 * Cloudflare cần chứng chỉ ở origin → cũng vậy. Nên các bước được viết để
 * CHẠY LẠI ĐƯỢC: bước đã xong tự báo "bỏ qua", bước chưa tới lượt báo "đang
 * chờ" kèm lý do. Bấm lần đầu làm được bốn bước; làm xong phần tay rồi bấm
 * lại, nó đi tiếp.
 *
 * Không tự chạy phần tay, và không tự chạy tiếp sau khi một bước hỏng: một
 * chuỗi chạy nửa chừng để lại trạng thái mà người bấm không mô tả được.
 */

export type StepStatus = "done" | "skipped" | "waiting" | "failed";

export interface StepResult {
  key: string;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface ProvisionInput {
  domainName: string;
  /** Danh tính site — bắt buộc, vì lib/publisher/site-config.ts coi thiếu là chưa dựng được. */
  name: string;
  vertical: string;
  tagline: string;
  description: string;
  /** IP máy chủ publisher. */
  serverIp: string;
}

export interface ProvisionReport {
  steps: StepResult[];
  /** Việc còn lại KHÔNG ai làm thay được, kèm lệnh chính xác. */
  manual: { title: string; commands: string[] }[];
}

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "").toLowerCase();

/**
 * Manifest của host này trong repo publisher, hoặc null.
 *
 * Đọc từ repo chứ không dựng lại: dựng manifest cần một lần gọi HQ cho mỗi ZIP
 * và mất vài phút. Việc đó thuộc về `npm run hq:markets`, chạy một lần, không
 * thuộc về một request từ trình duyệt.
 */
async function fetchRepoManifest(host: string): Promise<unknown | null> {
  const token = await getCredential("GITHUB_TOKEN");
  const repo = await getCredential("GITHUB_REPO");
  if (!token || !repo) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/data/sites/${host}/markets.json?ref=main`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

export async function provisionSite(input: ProvisionInput): Promise<ProvisionReport> {
  const steps: StepResult[] = [];
  const host = input.domainName.trim().toLowerCase();
  const siteUrl = `https://${host}`;

  const push = (r: StepResult) => {
    steps.push(r);
    return r.status !== "failed";
  };

  /**
   * BƯỚC ĐẦU TIÊN, trước cả zone: nghề này có đủ thứ để xuất bản chưa.
   *
   * Các bước còn lại lo hạ tầng — zone, DNS, GA4, secret — và chúng thành
   * công kể cả khi nghề chưa có một chữ nào của riêng nó. Đó đúng là cách
   * theaccidentrecord.com ra đời: hạ tầng xanh hết, rồi 112 trang in văn xuôi
   * nghề khác trong ba tuần.
   *
   * KHÔNG chặn việc dựng. Hạ tầng dựng trước rồi viết nội dung sau là một
   * trình tự hợp lệ, và chặn nó sẽ biến một lời nhắc thành một chướng ngại
   * người ta học cách đi vòng. Nhưng nó phải NÓI RA, ở bước đầu tiên, kèm tên
   * thứ thiếu và chuyện đã xảy ra khi thiếu.
   */
  const readiness = await checkReadiness(input.vertical);
  const missing = readiness.checks.filter((c) => !c.ok);
  push({
    key: "niche",
    title: `Nghề "${input.vertical}" sẵn sàng xuất bản`,
    status: readiness.ready ? (readiness.warnings > 0 ? "waiting" : "done") : "waiting",
    detail: readiness.ready && missing.length === 0
      ? `Đủ cả ${readiness.checks.length} mục.`
      : missing.map((c) => `${c.severity === "blocker" ? "THIẾU" : "mỏng"}: ${c.title} — ${c.detail}`).join("; ") +
        (readiness.ready
          ? ". Dựng được, nhưng trang sẽ mỏng hơn nghề đã đủ."
          : ". Dựng được HẠ TẦNG, nhưng ĐỪNG xuất bản nội dung trước khi bù đủ — trang sẽ nói sai nghề hoặc nói rỗng."),
  });

  const domain = await prisma.domain.findFirst({ where: { name: host } });
  if (!domain?.cloudflareZoneId) {
    push({
      key: "zone",
      title: "Zone Cloudflare",
      status: "failed",
      detail: `Domain "${host}" chưa có zone Cloudflare trong HQ. Thêm domain trước — nút này không tạo domain.`,
    });
    return { steps, manual: [] };
  }
  push({ key: "zone", title: "Zone Cloudflare", status: "skipped", detail: `Đã có: ${domain.cloudflareZoneId}` });

  const cfToken = await getCredential("CLOUDFLARE_API_TOKEN");

  // ── 1. A record, CHƯA proxy ────────────────────────────────────────────
  // Đám mây cam + SSL mode Full thì Cloudflare nối về origin bằng HTTPS, mà
  // origin chưa có chứng chỉ cho host này nên thử thách ACME chết — và chết ở
  // tầng edge, với thông báo nói về challenge chứ không nói về SSL mode.
  if (!cfToken) {
    push({ key: "dns", title: "A record", status: "failed", detail: "Chưa có CLOUDFLARE_API_TOKEN ở Cài đặt." });
  } else {
    try {
      const notes: string[] = [];
      let madeAny = false;
      let conflict = false;
      for (const h of [host, `www.${host}`]) {
        const { record, created: isNew } = await ensureDnsRecord(domain.cloudflareZoneId, h, input.serverIp, cfToken, {
          type: "A",
          proxied: false,
        });
        if (!isNew && record.content !== input.serverIp) {
          notes.push(`${h} ĐANG trỏ ${record.content} — KHÔNG đụng tới`);
          conflict = true;
        } else {
          notes.push(`${h} → ${input.serverIp}${isNew ? " (mới)" : " (đã có)"}`);
          madeAny = madeAny || isNew;
        }
      }
      /**
       * "done" chỉ khi THẬT SỰ tạo record. Bản đầu báo "done" cả khi không đổi
       * gì — và một nhãn như thế dạy người bấm rằng "done" không có nghĩa gì,
       * đúng lúc họ cần nó có nghĩa nhất.
       *
       * Trỏ sang IP khác là "waiting", không phải "done": lệnh này cố ý KHÔNG
       * đổi một hostname đang sống, nên việc đó vẫn còn nguyên đó chờ người.
       */
      push({
        key: "dns",
        title: "A record",
        status: conflict ? "waiting" : madeAny ? "done" : "skipped",
        detail: notes.join("; "),
      });
    } catch (e) {
      push({ key: "dns", title: "A record", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 2. GA4 property + luồng web ────────────────────────────────────────
  let ga4PropertyId: string | null = null;
  let ga4MeasurementId: string | null = null;
  const existing = await prisma.website.findFirst({ where: { url: siteUrl } });
  if (existing?.ga4PropertyId) {
    ga4PropertyId = existing.ga4PropertyId;
    ga4MeasurementId = existing.ga4MeasurementId;
    push({ key: "ga4", title: "GA4", status: "skipped", detail: `Đã có property ${ga4PropertyId}` });
  } else {
    try {
      const accounts = await listAccounts();
      if (accounts.length === 0) {
        push({
          key: "ga4",
          title: "GA4",
          status: "failed",
          detail: "Service Account không thấy tài khoản GA nào — cấp quyền ở cấp TÀI KHOẢN, không phải cấp property.",
        });
      } else {
        const made = await createPropertyWithWebStream({
          accountName: accounts[0].name,
          displayName: input.name,
          siteUrl,
        });
        ga4PropertyId = made.propertyId;
        ga4MeasurementId = made.measurementId;
        push({ key: "ga4", title: "GA4", status: "done", detail: `property ${made.propertyId}, luồng ${made.measurementId}` });
      }
    } catch (e) {
      const msg = e instanceof AnalyticsAdminError ? e.message : e instanceof Error ? e.message : String(e);
      push({ key: "ga4", title: "GA4", status: "failed", detail: msg });
    }
  }

  // ── 3. Nối Website vào HQ ──────────────────────────────────────────────
  // Không có GA4 thì vẫn nối: cột ga4PropertyId bắt buộc, nhưng một site nối
  // thiếu analytics vẫn phục vụ đúng, còn một site không nối thì không có gì
  // hoạt động cả.
  let websiteId: string | null = existing?.id ?? null;
  if (!ga4PropertyId && !existing) {
    push({
      key: "connect",
      title: "Nối Website",
      status: "waiting",
      detail: "Chờ GA4 — cột ga4PropertyId là bắt buộc. Sửa lỗi GA4 ở trên rồi bấm lại.",
    });
  } else {
    try {
      const site = await prisma.website.upsert({
        where: { gscPropertyUrl: `sc-domain:${host}` },
        create: {
          name: input.name,
          url: siteUrl,
          vertical: input.vertical,
          tagline: input.tagline,
          description: input.description,
          gscPropertyUrl: `sc-domain:${host}`,
          ga4PropertyId: ga4PropertyId ?? "",
          ga4MeasurementId,
        },
        update: {
          name: input.name,
          tagline: input.tagline,
          description: input.description,
          ...(ga4PropertyId ? { ga4PropertyId } : {}),
          ...(ga4MeasurementId ? { ga4MeasurementId } : {}),
        },
      });
      websiteId = site.id;
      push({ key: "connect", title: "Nối Website", status: existing ? "skipped" : "done", detail: `id ${site.id}` });
    } catch (e) {
      push({ key: "connect", title: "Nối Website", status: "failed", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── 4. Revalidate secret ───────────────────────────────────────────────
  // Secret là của BẢN TRIỂN KHAI, không của từng site: một app phục vụ nhiều
  // host thì mọi host dùng chung một giá trị. HQ lưu theo từng Website, nên
  // site mới phải nhận bản sao — giá trị không đi qua màn hình nào.
  if (websiteId) {
    const me = await prisma.website.findUnique({ where: { id: websiteId }, select: { revalidateSecret: true } });
    if (me?.revalidateSecret) {
      push({ key: "secret", title: "Revalidate secret", status: "skipped", detail: "Đã có." });
    } else {
      const donor = await prisma.website.findFirst({
        where: { revalidateSecret: { not: null }, id: { not: websiteId } },
        select: { url: true, revalidateSecret: true },
      });
      if (!donor?.revalidateSecret) {
        push({
          key: "secret",
          title: "Revalidate secret",
          status: "waiting",
          detail: "Chưa site nào có secret để sao chép. Đặt tay ở trang Publisher cho site đầu tiên.",
        });
      } else {
        await prisma.website.update({ where: { id: websiteId }, data: { revalidateSecret: donor.revalidateSecret } });
        push({ key: "secret", title: "Revalidate secret", status: "done", detail: `Chép từ ${hostOf(donor.url)}.` });
      }
    }
  }

  // ── 5. Cấp + đẩy khoá ──────────────────────────────────────────────────
  // Cần host TRẢ LỜI ĐƯỢC, nên bước này chỉ chạy sau khi nginx + cert + deploy
  // xong. Thất bại ở đây là chuyện BÌNH THƯỜNG ở lần bấm đầu.
  if (websiteId) {
    const live = await prisma.website.findUnique({
      where: { id: websiteId },
      select: { url: true, revalidateSecret: true },
    });
    const already = await prisma.publisherApiKey.findFirst({ where: { websiteId, revokedAt: null } });
    if (already) {
      push({ key: "key", title: "Khoá API", status: "skipped", detail: `Đã có khoá còn sống (${already.keyPrefix}).` });
    } else if (!live?.revalidateSecret) {
      push({ key: "key", title: "Khoá API", status: "waiting", detail: "Chờ revalidate secret." });
    } else {
      const { key, id } = await createPublisherKey(websiteId, "cấp bằng nút Dựng Site");
      const pushed = await pushKeyToSite(live, key);
      if (pushed.ok) {
        push({ key: "key", title: "Khoá API", status: "done", detail: "Đã đẩy sang site và site xác nhận." });
      } else {
        // HQ chỉ giữ băm, nên khoá không tới được site là khoá không ai cầm.
        await prisma.publisherApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
        push({
          key: "key",
          title: "Khoá API",
          status: "waiting",
          detail: `Chưa đẩy được (đã thu hồi khoá vừa tạo): ${pushed.detail}`,
        });
      }
    }
  }

  // ── 6. Bật proxy Cloudflare ────────────────────────────────────────────
  if (cfToken && domain.cloudflareZoneId) {
    const rec = await findDnsRecord(domain.cloudflareZoneId, host, "A", cfToken);
    if (!rec) {
      push({ key: "proxy", title: "Đám mây cam", status: "waiting", detail: "Chưa có A record." });
    } else if (rec.proxied) {
      push({ key: "proxy", title: "Đám mây cam", status: "skipped", detail: "Đã bật." });
    } else {
      // Chỉ bật khi host đã phục vụ HTTPS thật — bật sớm thì Cloudflare nối
      // về một origin chưa có chứng chỉ và cả site trả 526.
      let serving = false;
      try {
        const probe = await fetch(siteUrl, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
        serving = probe.status < 500;
      } catch {
        serving = false;
      }
      push({
        key: "proxy",
        title: "Đám mây cam",
        status: "waiting",
        detail: serving
          ? "Origin đã phục vụ HTTPS — bấm lại sau khi xác nhận chứng chỉ đúng host, hoặc bật tay."
          : `${siteUrl} chưa phục vụ HTTPS. Cần khối nginx + chứng chỉ trước, nếu không bật proxy sẽ ra 526.`,
      });
    }
  }

  // ── 7. Ghi dữ liệu vào repo publisher ──────────────────────────────────
  //
  // Manifest KHÔNG sinh ở đây: nó cần một lần gọi HQ cho từng ZIP (582 với
  // niche này) và mất vài phút — quá lâu cho một request từ trình duyệt, và
  // một nút treo bốn phút là một nút người ta bấm lại.
  //
  // Nên bước này chỉ ghi khi manifest ĐÃ có trong repo. Chưa có thì nó nói ra,
  // kèm đúng lệnh cần chạy — thay vì ghi ba phần tư dữ liệu rồi báo xong.
  const spec = specFor(input.vertical);
  if (!spec) {
    push({
      key: "repo",
      title: "Ghi vào repo",
      status: "waiting",
      detail: `Nghề "${input.vertical}" chưa có đặc tả nội dung trong HQ — khai ở lib/content-spec/niche-spec.ts.`,
    });
  } else {
    const existingManifest = await fetchRepoManifest(host);
    if (!existingManifest) {
      push({
        key: "repo",
        title: "Ghi vào repo",
        status: "waiting",
        detail:
          `Chưa có manifest cho ${host} trong repo. Chạy \`npm run hq:markets -- --host ${host}\` ` +
          `rồi bấm lại — không ghi thiếu file, vì một publisher có danh tính mà không có trang là hỏng câm.`,
      });
    } else {
      const written = await writeSiteToRepo({
        host,
        site: {
          host,
          name: input.name,
          url: siteUrl,
          vertical: input.vertical,
          tagline: input.tagline,
          description: input.description,
        },
        manifest: existingManifest,
        spec,
      });
      push({
        key: "repo",
        title: "Ghi vào repo",
        status: written.ok ? "done" : "waiting",
        detail: written.prUrl ? `${written.detail} ${written.prUrl}` : written.detail,
      });
    }
  }

  return { steps, manual: manualSteps(host, input.vertical) };
}

/**
 * Việc HQ KHÔNG làm được, kèm lệnh chính xác.
 *
 * Danh sách này NGẮN DẦN, và đó là thước đo tiến độ thật của nút này:
 *
 *   18/9/2026 sáng   nginx + chứng chỉ · bảng site + manifest · Search Console
 *   18/9/2026 chiều  khối nginx CHUNG xoá bỏ mục thứ nhất
 *                    đường ghi qua GitHub API xoá phần lớn mục thứ hai
 *
 * Còn lại: một lệnh kéo manifest (chậm, chạy một lần), và Search Console —
 * thứ Google bắt buộc con người xác minh quyền sở hữu, không tự động được và
 * không nên tự động được.
 */
function manualSteps(host: string, vertical: string): ProvisionReport["manual"] {
  return [
    {
      title: `Manifest cho ${host} — cần chạy MỘT LẦN, trong repo publisher`,
      commands: [
        `npm run hq:markets -- --host ${host}`,
        `npm run data:index && git add data && git commit && git push`,
        `# Không làm từ đây được: một lần gọi HQ cho mỗi ZIP, mất vài phút.`,
        `# Xong bước này rồi bấm lại "Dựng Site" — nó sẽ tự ghi phần còn lại và mở PR.`,
      ],
    },
    {
      title: "Search Console",
      commands: [
        `# thêm ${host} vào Search Console, cấp quyền cho Service Account ở cấp property`,
        `# niche: ${vertical}`,
      ],
    },
  ];
}
