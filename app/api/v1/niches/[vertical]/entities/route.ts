import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { prisma } from "@/lib/db/prisma";
import { axesFor } from "@/lib/page-axis/axes";

/**
 * GET /api/v1/niches/{vertical}/entities
 *
 * KHO HÀNG TRANG của một nghề đi trục thực thể: mỗi hàng là một trang
 * publisher được phép dựng, kèm axis, khoá, trang cha và tên hiển thị.
 *
 * ═══ VÌ SAO PUBLISHER KHÔNG TỰ SUY RA DANH SÁCH NÀY ═══
 *
 * Nó suy được — 5 mã giải nhân danh sách đội là ra 96 trang đội và 876 cặp.
 * Nhưng suy được không có nghĩa là nên suy: làm thế đặt định nghĩa "site này
 * có những trang nào" vào HAI nơi, và chúng sẽ lệch đúng vào ngày một đội
 * xuống hạng. Lúc đó sitemap nói một đằng, `generateStaticParams` nói một
 * nẻo, và không có gì đỏ.
 *
 * HQ đã có định nghĩa đó dưới dạng hàng `EntityIdentity`, và `football:sync`
 * là chỗ duy nhất ghi vào nó. Route này chỉ đọc ra.
 *
 * ═══ TRẢ TOÀN BỘ, KHÔNG PHÂN TRANG ═══
 *
 * 977 hàng, mỗi hàng năm trường ngắn — vài chục KB. Publisher gọi nó MỘT lần
 * lúc `npm run hq:entities` rồi commit kết quả; đây không phải endpoint nằm
 * trên đường render. Thêm phân trang vào một thứ gọi mỗi tuần một lần là thêm
 * một vòng lặp có thể dừng giữa chừng và ghi ra một manifest THIẾU, mà một
 * manifest thiếu thì trang biến mất chứ không báo lỗi.
 */
export async function GET(request: Request, ctx: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await ctx.params;
  const decoded = decodeURIComponent(vertical);

  // Phạm vi trước, dữ liệu sau: khoá của publisher này chỉ đọc được niche của
  // chính nó.
  const unauthorized = await requireApiKey(request, { vertical: decoded });
  if (unauthorized) return unauthorized;

  const axes = axesFor(decoded);
  if (axes.length === 0) {
    return apiJson(
      {
        error: `Nghề "${decoded}" không đi theo trục thực thể.`,
        hint: "Nghề đi trục ZIP thì hỏi /markets. Trục mới thì khai ở lib/page-axis/axes.ts bên Head Quarter.",
      },
      { status: 404 }
    );
  }

  const rows = await prisma.entityIdentity.findMany({
    where: { vertical: decoded },
    select: { axis: true, key: true, parentKey: true, displayName: true },
    // Thứ tự ỔN ĐỊNH giữa hai lần gọi. Không có nó, `entities.json` đổi thứ tự
    // mỗi lần kéo về và mọi lần `npm run hq:entities` đều sinh ra một diff —
    // một diff ồn ào là một diff không ai đọc.
    orderBy: [{ axis: "asc" }, { key: "asc" }],
  });

  if (rows.length === 0) {
    // 404 chứ không phải mảng rỗng: một danh sách rỗng đọc như "nghề này không
    // có trang nào", và publisher sẽ ghi đè manifest đang chạy bằng một file
    // rỗng rồi coi đó là kết quả đúng.
    return apiJson(
      {
        error: `Nghề "${decoded}" chưa có hàng EntityIdentity nào.`,
        hint: "Chạy `npm run football:sync` bên Head Quarter.",
      },
      { status: 404 }
    );
  }

  return apiJson({
    vertical: decoded,
    generatedAt: new Date().toISOString(),
    // Bộ khung trục đi KÈM, để publisher dựng breadcrumb mà không phải suy từ
    // hình dạng khoá.
    axes: axes.map((a) => ({ axis: a.axis, label: a.label, parentAxis: a.parentAxis })),
    counts: Object.fromEntries(axes.map((a) => [a.axis, rows.filter((r) => r.axis === a.axis).length])),
    entities: rows,
  });
}
