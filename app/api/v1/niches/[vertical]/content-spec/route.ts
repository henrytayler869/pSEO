import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { specFor } from "@/lib/content-spec/niche-spec";

/**
 * GET /api/v1/niches/{vertical}/content-spec
 *
 * Trang thị trường của nghề này gồm mục nào, mỗi mục cần chỉ số gì, và ở độ
 * phân giải địa lý nào.
 *
 * Phạm vi THEO NICHE, không phải "no-scope" như /content-rules. Khác biệt có
 * lý do: /content-rules là LUẬT mọi publisher phải tuân, giấu đi không bảo vệ
 * được gì. Còn đây là cấu trúc trang của một nghề cụ thể — một publisher đọc
 * được đặc tả của nghề khác thì không nguy hiểm, nhưng cũng không có việc gì
 * để làm với nó, và phạm vi hẹp là mặc định đúng.
 *
 * Trả 404 cho nghề chưa có đặc tả, KHÔNG trả rỗng. Một đặc tả rỗng đọc như
 * "nghề này không có mục nào", và publisher sẽ dựng một trang trống rồi coi
 * đó là kết quả đúng.
 */
export async function GET(request: Request, ctx: { params: Promise<{ vertical: string }> }) {
  const { vertical } = await ctx.params;
  const decoded = decodeURIComponent(vertical);

  const unauthorized = await requireApiKey(request, { vertical: decoded });
  if (unauthorized) return unauthorized;

  const spec = specFor(decoded);
  if (!spec) {
    return apiJson(
      {
        error: `Chưa có đặc tả nội dung cho nghề "${decoded}".`,
        hint: "Khai trong lib/content-spec/niche-spec.ts bên Head Quarter. Trang thị trường KHÔNG được dựng khi thiếu nó.",
      },
      { status: 404 }
    );
  }
  return apiJson(spec);
}
