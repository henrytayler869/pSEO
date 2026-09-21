import { prisma } from "@/lib/db/prisma";
import { specFor, metricsNamedBy } from "@/lib/content-spec/niche-spec";
import { VERTICALS_WITH_BRIEFS } from "@/lib/ai/generate";
import { REQUIRED_METRICS_BY_ADAPTER, EXPECTED_METRICS_BY_ADAPTER } from "@/lib/validation/config";

/**
 * Nghề này đã đủ thứ để dựng một site KHÔNG lặp lại lỗi của site trước chưa.
 *
 * ═══ VÌ SAO TỒN TẠI ═══
 *
 * `provisionSite` lo hạ tầng: zone, DNS, GA4, nối Website, secret. Nó KHÔNG
 * hỏi "nghề này đã có đủ chữ để xuất bản chưa", nên theaccidentrecord.com
 * được dựng cho một nghề thiếu nửa tầng nội dung và không gì nói ra. Hậu quả
 * lộ dần trong ba tuần, mỗi lần một mảnh:
 *
 *   112/112 trang in chữ nghề chuyển nhà        đặc tả thiếu khối cụm + khối ZIP
 *    63 trang không có FAQ lẫn FAQPage          đặc tả thiếu khối faq
 *    27 trang canonical trỏ URL 404             chuỗi viết cứng trong mã
 *     1 trang trụ so với 2 của nghề kia         không ai đếm
 *
 * Mỗi mảnh sửa xong là một lần đỡ cho site THỨ HAI. Bảng này là để site THỨ
 * BA không phải đi lại đường đó: hỏi TRƯỚC KHI dựng, và nêu tên thứ thiếu
 * kèm chuyện đã xảy ra khi nó thiếu.
 *
 * ═══ CHẶN VÀ NHẮC LÀ HAI VIỆC KHÁC NHAU ═══
 *
 * `blocker` = thiếu thì trang sẽ nói sai hoặc nói rỗng, và điều đó công khai.
 * `warning` = trang vẫn đúng, chỉ là mỏng hơn hoặc kém hiệu quả.
 *
 * Gộp hai nhóm làm một sẽ dạy người bấm bỏ qua cả hai — đúng cách một cổng
 * canh chết đi mà vẫn còn trong mã.
 */

/**
 * Nghề còn đi bằng văn xuôi VIẾT TAY trong kho publisher.
 *
 * Bản sao của `NICHES_WITH_COPY` bên publisher (lib/content/niche-copy.ts), và
 * nói thẳng ra là bản sao: HQ không đọc được kho kia, kho kia không commit vào
 * đây. KHÔNG CỔNG NÀO KIỂM ĐƯỢC ràng buộc này — cùng loại với ràng buộc song
 * sinh của launch.json, và cùng cách xử lý: ghi ra chỗ người sửa sau sẽ đọc.
 *
 * Danh sách này phải TEO DẦN VỀ RỖNG. Đường viết tay là đường cũ: nó đúng cho
 * một nghề và sai cho nghề kế tiếp, và chính nó đã in 90 trang chuyển nhà lên
 * một site luật sư tai nạn. moving-services còn ở đây vì bộ FAQ 5 câu viết tay
 * của nó đang chạy tốt, và hai nguồn cho cùng một khối sẽ lệch nhau.
 *
 * Nghề MỚI không được vào danh sách này. Với chúng, thiếu khối faq trong đặc
 * tả là thiếu thật.
 */
const LEGACY_HANDWRITTEN_VERTICALS = ["moving-services"];

export interface ReadinessCheck {
  key: string;
  title: string;
  ok: boolean;
  severity: "blocker" | "warning";
  detail: string;
  /** Chuyện đã xảy ra khi thiếu mục này. Rỗng nếu chưa từng xảy ra. */
  incident?: string;
}

export interface NicheReadiness {
  vertical: string;
  ready: boolean;
  blockers: number;
  warnings: number;
  checks: ReadinessCheck[];
}

export async function checkNicheReadiness(vertical: string): Promise<NicheReadiness> {
  const checks: ReadinessCheck[] = [];
  const spec = specFor(vertical);

  checks.push({
    key: "spec",
    title: "Đặc tả nội dung",
    ok: spec !== null && spec.sections.length > 0,
    severity: "blocker",
    detail: spec ? `${spec.sections.length} mục` : "CHƯA có — khai ở lib/content-spec/niche-spec.ts",
    incident:
      "Không có đặc tả thì publisher rơi về văn xuôi viết tay của nghề khác. 90 trang tai nạn " +
      "lên production ngày 18/9/2026 nói về chuyển nhà trước khi bị chặn bằng noindex.",
  });

  checks.push({
    key: "cluster",
    title: "Khối chữ cho trang CỤM",
    ok: !!spec?.cluster,
    severity: "blocker",
    detail: spec?.cluster ? `tiêu đề mục trụ: "${spec.cluster.topicsHeading}"` : "CHƯA có",
    incident:
      "27 trang cụm của theaccidentrecord.com in meta description 'Household migration across " +
      "Kings County…' trên một site luật sư tai nạn, tới tận 20/9/2026.",
  });

  checks.push({
    key: "market",
    title: "Khối chữ cho trang MỘT ZIP",
    ok: !!spec?.market,
    severity: "blocker",
    detail: spec?.market ? `${spec.market.leadMetrics.length} chỉ số mở đầu mô tả` : "CHƯA có",
    incident:
      "63 trang ZIP dùng chung một meta description không phân biệt gì, vì chỉ số mở đầu bị " +
      "ghim cứng theo nghề chuyển nhà. Meta description là chuỗi Google in dưới tiêu đề.",
  });

  const faqCount = spec?.faq?.entries.length ?? 0;
  const legacy = LEGACY_HANDWRITTEN_VERTICALS.includes(vertical);
  checks.push({
    key: "faq",
    title: "Khối FAQ",
    // Nghề đi đường viết tay thì FAQ có thật trên trang, chỉ là không đến từ
    // đặc tả. Báo nó "thiếu" sẽ là một cờ đỏ sai — và một cờ đỏ sai dạy người
    // bấm bỏ qua cả bảng.
    ok: faqCount > 0 || legacy,
    severity: legacy ? "warning" : "blocker",
    detail: faqCount > 0
      ? `${faqCount} câu`
      : legacy
        ? "đặc tả chưa khai — nghề này còn dùng bộ viết tay ở publisher (đường CŨ)"
        : "CHƯA có",
    incident:
      "Thiếu khối này thì trang KHÔNG có FAQ và KHÔNG có FAQPage — và cổng noindex hasNicheCopy " +
      "đòi có faq, nên cả site sẽ bị noindex mà không ai thấy lý do.",
  });

  checks.push({
    key: "brief",
    title: "Brief cho tầng AI",
    ok: VERTICALS_WITH_BRIEFS.includes(vertical),
    severity: "blocker",
    detail: VERTICALS_WITH_BRIEFS.includes(vertical) ? "đã có" : "CHƯA có — khai ở lib/ai/generate.ts",
    incident:
      "Không có brief thì prompt không biết nghề này KHÔNG được nói gì. Với nghề rủi ro cao " +
      "(luật, y tế, tài chính) đó là chỗ một lời hứa kết quả lọt vào văn bản đã xuất bản.",
  });

  // ── Dữ liệu ────────────────────────────────────────────────────────────
  const sources = await prisma.dataSource.findMany({
    where: { relevantVerticals: { has: vertical }, isActive: true },
    select: { adapterKey: true, name: true },
  });
  checks.push({
    key: "sources",
    title: "Nguồn dữ liệu khai cho nghề",
    ok: sources.length > 0,
    severity: "blocker",
    detail: sources.length > 0 ? sources.map((s) => s.adapterKey).join(", ") : "KHÔNG nguồn nào",
    incident: "Không nguồn nào thì mọi trang rỗng số liệu, và trang chỉ còn là khung.",
  });

  const unconfigured = sources.filter(
    (s) => !(s.adapterKey in REQUIRED_METRICS_BY_ADAPTER) && !(s.adapterKey in EXPECTED_METRICS_BY_ADAPTER)
  );
  checks.push({
    key: "validation",
    title: "Chỉ số đăng ký với luật completeness",
    ok: unconfigured.length === 0,
    severity: "blocker",
    detail:
      unconfigured.length === 0
        ? `${sources.length}/${sources.length} nguồn đã khai`
        : `THIẾU: ${unconfigured.map((s) => s.adapterKey).join(", ")}`,
    incident:
      "Adapter không khai chỉ số thì luật completeness KHÔNG kiểm gì cho nguồn đó, và 0 cờ đọc " +
      "y hệt 'đã kiểm, không thiếu gì'.",
  });

  /**
   * Chỉ số đặc tả nhắc tới có thật trong DB chưa.
   *
   * Đặc tả có thể nêu một chỉ số mà chưa adapter nào phát — lúc đó mục tương
   * ứng KHÔNG render, im lặng, và trang mỏng đi mà không ai biết vì sao.
   */
  if (spec) {
    const named = [...metricsNamedBy(spec)];
    const present = await prisma.dataPoint.findMany({
      where: { metric: { in: named } },
      select: { metric: true },
      distinct: ["metric"],
    });
    const have = new Set(present.map((p) => p.metric));
    const missing = named.filter((m) => !have.has(m));
    checks.push({
      key: "metrics",
      title: "Chỉ số của đặc tả có trong dữ liệu",
      ok: missing.length === 0,
      severity: "blocker",
      detail: missing.length === 0 ? `${named.length}/${named.length} có thật` : `THIẾU: ${missing.join(", ")}`,
      incident: "Mục đặc tả đòi một chỉ số chưa ai thu thì mục đó không bao giờ render, và im lặng.",
    });
  }

  // ── Độ dày, so với nghề dày nhất đang có ───────────────────────────────
  const sectionCount = spec?.sections.length ?? 0;
  checks.push({
    key: "depth",
    title: "Số mục đặc tả",
    ok: sectionCount >= 3,
    severity: "warning",
    detail: `${sectionCount} mục` + (sectionCount < 3 ? " — nghề dày nhất hiện có là 3" : ""),
    incident:
      "Đo 20/9/2026: trang ZIP nghề tai nạn 932 chữ và 10 PropertyValue, nghề chuyển nhà 1.801 " +
      "chữ và 28. Cùng khuôn, khác độ dày, và khác biệt nằm ở số mục đặc tả.",
  });

  const zipScoped = spec?.sections.filter((s) => s.scope === "ZIP").length ?? 0;
  checks.push({
    key: "zip-axis",
    title: "Mục ở cấp ZIP",
    ok: zipScoped >= 1,
    severity: "warning",
    detail:
      `${zipScoped} mục cấp ZIP` +
      (zipScoped === 0 ? " — mọi ZIP trong một hạt sẽ in số liệu giống hệt nhau" : ""),
    incident:
      "21/76 trang của nghề tai nạn từng có governmentData trùng khít từng chữ số — 5 trang Los " +
      "Angeles cùng in 817 vụ / 1.199 người chết, khác nhau mỗi tên thành phố. Đó là thin content.",
  });

  const blockers = checks.filter((c) => !c.ok && c.severity === "blocker").length;
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning").length;
  return { vertical, ready: blockers === 0, blockers, warnings, checks };
}
