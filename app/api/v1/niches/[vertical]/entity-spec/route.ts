import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { entitySpecFor } from "@/lib/content-spec/entity-spec";
import { axesFor } from "@/lib/page-axis/axes";

/**
 * GET /api/v1/niches/{vertical}/entity-spec
 *
 * Đặc tả nội dung cho nghề đi theo trục KHÔNG địa lý: mỗi loại trang gồm mục
 * nào, mục cần chỉ số gì, và ở phạm vi nào (đội / giải / cặp đối đầu).
 *
 * ═══ VÌ SAO ROUTE RIÊNG, KHÔNG PHẢI MỞ RỘNG /content-spec ═══
 *
 * /content-spec đang phục vụ HAI site sống, và hình dạng nó trả về được
 * publisher đọc bằng một kiểu TypeScript chứ không bằng validator lúc chạy.
 * Nhồi thêm một hình dạng thứ hai vào cùng một route nghĩa là caller phải
 * đoán mình vừa nhận cái gì — và cách đoán rẻ nhất là nhìn xem trường nào
 * khác null, tức đúng kiểu "nửa số trường luôn rỗng" mà việc tách
 * EntityContentSpec khỏi NicheContentSpec đã tránh.
 *
 * Hai route thì câu hỏi "trang này thuộc trục nào" được trả lời bằng ĐƯỜNG
 * DẪN, trước khi có ai phải phân tích thân phản hồi.
 *
 * Trả 404 cho nghề không đi trục này, KHÔNG trả rỗng — cùng lý do với
 * /content-spec: một đặc tả rỗng đọc như "nghề này không có mục nào", và
 * publisher sẽ dựng một trang trống rồi coi đó là kết quả đúng.
 */
export async function GET(request: Request, ctx: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await ctx.params;
  const decoded = decodeURIComponent(vertical);

  // Phạm vi trước, dữ liệu sau: khoá của publisher này chỉ đọc được niche của
  // chính nó.
  const unauthorized = await requireApiKey(request, { vertical: decoded });
  if (unauthorized) return unauthorized;

  const spec = entitySpecFor(decoded);
  if (!spec) {
    return apiJson(
      {
        error: `Nghề "${decoded}" không có đặc tả trục không-địa-lý.`,
        hint:
          "Nghề đi theo trục ZIP thì hỏi /content-spec. Nghề mới đi trục thực thể thì khai ở " +
          "lib/content-spec/entity-spec.ts bên Head Quarter.",
      },
      { status: 404 }
    );
  }

  return apiJson({
    // Bộ khung trục đi KÈM đặc tả, chứ không để publisher tự suy từ danh sách
    // `pages`. Publisher cần biết trang cha của một trang là loại gì để dựng
    // breadcrumb và liên kết nội bộ, và suy ngược điều đó từ đặc tả nội dung
    // là bắt một file mô tả CHỮ phải trả lời một câu hỏi về CẤU TRÚC.
    axes: axesFor(decoded).map((a) => ({
      axis: a.axis,
      label: a.label,
      parentAxis: a.parentAxis,
    })),
    ...spec,
  });
}
