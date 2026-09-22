import { prisma } from "@/lib/db/prisma";
import { entitySpecFor, metricsNamedByEntity } from "@/lib/content-spec/entity-spec";
import { ENTITY_VERTICALS_WITH_BRIEFS } from "@/lib/ai/entity-generate";
import { axesFor } from "@/lib/page-axis/axes";
import type { ReadinessCheck, NicheReadiness } from "@/lib/publisher/niche-readiness";

/**
 * Nghề đi theo trục KHÔNG địa lý đã đủ thứ để dựng site chưa.
 *
 * ═══ VÌ SAO KHÔNG DÙNG LẠI `checkNicheReadiness` ═══
 *
 * Bảng kia hỏi sáu câu mà với nghề này KHÔNG câu nào trả lời được một cách
 * trung thực:
 *
 *   cluster / market     hai khối gắn chặt với ZIP và cụm ZIP; nghề này không có
 *   sources              đọc DataSource; nghề này không có adapter nào, nguồn là
 *                        openfootball đọc thẳng lúc dựng trang
 *   validation           đọc REQUIRED_METRICS_BY_ADAPTER; không adapter thì không có gì
 *   metrics              đọc prisma.dataPoint; chỉ số ở đây là TÍNH ĐƯỢC, không THU VỀ,
 *                        nên bảng đó sẽ đỏ vĩnh viễn vì một lý do sai
 *   zip-axis             không có ZIP
 *
 * Chạy bảng cũ cho nghề này sẽ cho ra 5 cờ đỏ mà không cờ nào chỉ đúng vấn
 * đề — và một bảng đỏ vì lý do sai dạy người ta bấm bỏ qua cả bảng, đúng cách
 * một cổng canh chết đi mà vẫn còn trong mã.
 *
 * ═══ CHỖ KHÔNG ĐƯỢC LÀM GIẢ ═══
 *
 * Phép kiểm "chỉ số đặc tả có thật không" ở đây KHÔNG chạy được rẻ: trả lời
 * nó đúng nghĩa là chạy tầng chỉ số trên dữ liệu thật của 5 giải, tức năm
 * lượt gọi mạng — không thuộc về một trang web. Nên bảng này KHÔNG giả vờ
 * kiểm nó; nó nói thẳng rằng phép kiểm đó nằm ở `npm run verify:entity-spec`
 * và nêu tên lệnh.
 *
 * Viết một ô xanh cho một phép kiểm không chạy là thứ tệ hơn không có ô nào:
 * 0 cờ đọc y hệt "đã kiểm, không thiếu gì".
 */
export async function checkEntityNicheReadiness(vertical: string): Promise<NicheReadiness> {
  const checks: ReadinessCheck[] = [];
  const spec = entitySpecFor(vertical);
  const axes = axesFor(vertical);

  checks.push({
    key: "entity-spec",
    title: "Đặc tả nội dung (trục thực thể)",
    ok: spec !== null && spec.pages.length > 0,
    severity: "blocker",
    detail: spec ? `${spec.pages.length} loại trang` : "CHƯA có — khai ở lib/content-spec/entity-spec.ts",
    incident:
      "Không có đặc tả thì publisher không có chữ nào cho nghề này, và nhánh cũ sẽ rơi về văn xuôi " +
      "của nghề khác. 90 trang tai nạn lên production ngày 18/9/2026 nói về chuyển nhà đúng vì vậy.",
  });

  // Mọi axis đã khai phải có một trang mô tả nó. Thiếu nghĩa là có một loại
  // trang được sinh ra mà không ai nói nó gồm mục gì.
  const missingPages = axes.filter((a) => !spec?.pages.some((p) => p.axis === a.axis));
  checks.push({
    key: "axis-coverage",
    title: "Mỗi axis đều có đặc tả trang",
    ok: axes.length > 0 && missingPages.length === 0,
    severity: "blocker",
    detail:
      axes.length === 0
        ? "CHƯA khai axis nào ở lib/page-axis/axes.ts"
        : missingPages.length === 0
          ? `${axes.length}/${axes.length} axis đã có trang`
          : `THIẾU trang cho: ${missingPages.map((a) => a.axis).join(", ")}`,
    incident:
      "football:sync ghi hàng danh tính cho MỌI axis đã khai. Axis có hàng mà không có đặc tả nghĩa là " +
      "một loạt URL tồn tại trong sitemap và dựng ra trang trống.",
  });

  /**
   * Mỗi trang phải có ít nhất một mục ở CHÍNH phạm vi của nó.
   *
   * Đây là bản dịch của phép kiểm `zip-axis` sang trục này, và nó bắt đúng
   * cùng một bệnh: 21/76 trang của nghề tai nạn từng in governmentData trùng
   * khít từng chữ số vì mọi mục đều ở cấp hạt. Ở đây, một trang đội mà mọi
   * mục đều scope LEAGUE sẽ in ra 20 trang giống hệt nhau, khác mỗi tên đội.
   */
  const scopeOfAxis: Record<string, string> = { team: "TEAM", fixture: "FIXTURE", league: "LEAGUE" };
  const thin = (spec?.pages ?? []).filter((p) => {
    const own = scopeOfAxis[p.axis];
    return own !== undefined && !p.sections.some((s) => s.scope === own);
  });
  checks.push({
    key: "own-scope",
    title: "Mỗi trang có mục ở phạm vi của chính nó",
    ok: thin.length === 0,
    severity: "warning",
    detail:
      thin.length === 0
        ? `${spec?.pages.length ?? 0}/${spec?.pages.length ?? 0} trang có mục riêng`
        : `CHỈ có số liệu cấp trên: ${thin.map((p) => p.axis).join(", ")}`,
    incident:
      "Trang đội mà mọi mục đều ở cấp GIẢI sẽ in ra 20 trang giống hệt nhau, khác mỗi tên đội. " +
      "Đó là thin content, và nó là đúng bệnh mà phép kiểm zip-axis của trục địa lý sinh ra để bắt.",
  });

  const faqPages = (spec?.pages ?? []).filter((p) => (p.faq?.entries.length ?? 0) > 0);
  checks.push({
    key: "faq",
    title: "Khối FAQ",
    ok: faqPages.length > 0,
    severity: "blocker",
    detail:
      faqPages.length > 0
        ? `${faqPages.length}/${spec?.pages.length ?? 0} loại trang có FAQ`
        : "CHƯA trang nào có FAQ",
    incident:
      "Thiếu khối này thì trang KHÔNG có FAQ và KHÔNG có FAQPage. Nghề này là nghề MỚI nên không có " +
      "đường viết tay nào ở publisher để rơi về — thiếu là thiếu thật.",
  });

  checks.push({
    key: "brief",
    title: "Brief cho tầng AI",
    ok: ENTITY_VERTICALS_WITH_BRIEFS.includes(vertical),
    severity: "blocker",
    detail: ENTITY_VERTICALS_WITH_BRIEFS.includes(vertical)
      ? "đã có, kèm system prompt riêng của trục thực thể"
      : "CHƯA có — khai ở lib/ai/entity-generate.ts. KHÔNG dùng VERTICALS_WITH_BRIEFS của trục địa lý: " +
        "prompt bên đó viết cho trang dịch vụ địa phương, nên một nghề có tên ở đó vẫn không có prompt dùng được",
    incident:
      "Prompt hiện có ràng buộc theo phạm vi ZIP/hạt và theo phía cung của một nghề dịch vụ. Dùng nó " +
      "cho bóng đá là thả một model vào một bộ luật không nói gì về việc nó đang viết cái gì.",
  });

  // Hàng danh tính: phép kiểm DB THẬT, rẻ, và trả lời đúng câu "đã có trang chưa".
  const rows = await prisma.entityIdentity.groupBy({
    by: ["axis"],
    where: { vertical },
    _count: { _all: true },
  });
  const byAxis = new Map(rows.map((r) => [r.axis, r._count._all]));
  const emptyAxes = axes.filter((a) => (byAxis.get(a.axis) ?? 0) === 0);
  checks.push({
    key: "identity-rows",
    title: "Hàng danh tính trong database",
    ok: axes.length > 0 && emptyAxes.length === 0,
    severity: "blocker",
    detail:
      rows.length === 0
        ? "KHÔNG hàng nào — chạy `npm run football:sync`"
        : axes
            .map((a) => `${a.axis} ${byAxis.get(a.axis) ?? 0}`)
            .join(", "),
    incident:
      "Không hàng nào thì getVerticalsWithPages không thấy nghề này, và nút nối Website từ chối nó " +
      "với thông báo về một file coverage không bao giờ tồn tại.",
  });

  /**
   * Phép kiểm chỉ số KHÔNG chạy ở đây, và ô này nói ra điều đó.
   *
   * `ok: false` với severity warning, chứ không phải một ô xanh: câu trả lời
   * trung thực là "chưa kiểm ở đây", và "chưa kiểm" không được phép trông
   * giống "đã kiểm, sạch".
   */
  const named = spec ? metricsNamedByEntity(spec) : new Set<string>();
  checks.push({
    key: "metrics",
    title: "Chỉ số của đặc tả có thật",
    ok: false,
    severity: "warning",
    detail:
      `${named.size} chỉ số được nhắc tới. Phép kiểm nằm ở \`npm run verify:entity-spec\` — nó chạy ` +
      "tầng chỉ số trên dữ liệu thật của 5 giải và đối chiếu hai chiều. KHÔNG chạy được từ trang web " +
      "(năm lượt gọi mạng).",
    incident:
      "Mục đặc tả đòi một chỉ số chưa ai tính thì mục đó không bao giờ render, và im lặng. Với nghề " +
      "này chỉ số là TÍNH ĐƯỢC chứ không THU VỀ, nên bảng DataPoint không trả lời được câu hỏi đó.",
  });

  const sections = (spec?.pages ?? []).reduce((n, p) => n + p.sections.length, 0);
  checks.push({
    key: "depth",
    title: "Số mục đặc tả",
    ok: sections >= 6,
    severity: "warning",
    detail: `${sections} mục trên ${spec?.pages.length ?? 0} loại trang` + (sections < 6 ? " — mỏng" : ""),
    incident:
      "Đo 20/9/2026: trang ZIP nghề tai nạn 932 chữ và 10 PropertyValue, nghề chuyển nhà 1.801 chữ và " +
      "28. Cùng khuôn, khác độ dày, và khác biệt nằm ở số mục đặc tả.",
  });

  const blockers = checks.filter((c) => !c.ok && c.severity === "blocker").length;
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning").length;
  return { vertical, ready: blockers === 0, blockers, warnings, checks };
}
