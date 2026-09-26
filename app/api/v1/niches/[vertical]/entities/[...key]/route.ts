import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { prisma } from "@/lib/db/prisma";
import { buildEntityFactSet, getCachedEntityInterpretation } from "@/lib/ai/entity-generate";
import { entityPageSpecFor } from "@/lib/content-spec/entity-spec";
import { parseKey } from "@/lib/page-axis/axes";

/**
 * GET /api/v1/niches/{vertical}/entities/{key...}
 *
 * Bộ số liệu của MỘT trang: fact đã đo, cộng đoạn diễn giải AI nếu đã có.
 * Bản đối ứng của `/markets/{zip}` ở trục ZIP, và cố ý giống nó — publisher
 * đã có sẵn hình dạng "liệt kê ở một route, chi tiết ở route khác".
 *
 * ═══ VÌ SAO `[...key]` CHỨ KHÔNG PHẢI `[key]` ═══
 *
 * Khoá mang dấu `/` — "en-1/arsenal-fc" — nên nó chiếm HAI segment. Bắt
 * publisher mã hoá nó thành `en-1%2Farsenal-fc` thì đường dẫn API không còn
 * đọc được bằng mắt, và một lần quên `encodeURIComponent` sẽ ra 404 chứ không
 * ra lỗi rõ ràng. Catch-all giữ khoá nguyên hình dạng nó vốn có.
 *
 * ═══ KHÔNG SINH VĂN Ở ĐÂY ═══
 *
 * Route này chỉ ĐỌC cache. Sinh văn tốn tiền và tốn nhiều giây, và một route
 * mà lần gọi đầu tiên tiêu tiền là một route không ai dám gọi để thử. Sinh
 * bằng `npm run entity:generate` hoặc lô, rồi trang mới thấy.
 *
 * Nên `interpretation: null` là câu trả lời BÌNH THƯỜNG, không phải lỗi, và
 * trang phải render đủ khi thiếu nó — số liệu là phần chính, đoạn văn là phần
 * thêm.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ vertical: string; key: string[] }> }
) {
  const { vertical, key } = await ctx.params;
  const decodedVertical = decodeURIComponent(vertical);
  const entityKey = key.map((k) => decodeURIComponent(k)).join("/");

  const unauthorized = await requireApiKey(request, { vertical: decodedVertical });
  if (unauthorized) return unauthorized;

  const parsed = parseKey(entityKey);
  if (!parsed) {
    return apiJson({ error: `Khoá "${entityKey}" không đọc được.` }, { status: 404 });
  }

  // Danh tính phải CÓ THẬT trong kho hàng trang. Không kiểm bước này thì một
  // khoá đúng cú pháp nhưng không thuộc site nào vẫn trả về fact, và publisher
  // sẽ dựng được một trang mà sitemap không biết — đúng hình dạng soft 404 mà
  // kho này đã dọn một lần.
  const identity = await prisma.entityIdentity.findUnique({
    where: { vertical_axis_key: { vertical: decodedVertical, axis: parsed.axis, key: entityKey } },
    select: { axis: true, key: true, parentKey: true, displayName: true },
  });
  if (!identity) {
    return apiJson(
      { error: `Nghề "${decodedVertical}" không có trang ${parsed.axis} "${entityKey}".` },
      { status: 404 }
    );
  }

  const factSet = await buildEntityFactSet(decodedVertical, parsed.axis, entityKey);
  if (!factSet) {
    return apiJson({ error: `Không dựng được fact cho "${entityKey}".` }, { status: 404 });
  }

  const cached = await getCachedEntityInterpretation(decodedVertical, parsed.axis, entityKey);

  return apiJson({
    vertical: decodedVertical,
    axis: identity.axis,
    key: identity.key,
    parentKey: identity.parentKey,
    displayName: identity.displayName,
    leagueName: factSet.leagueName,
    season: factSet.season,
    /** Ngày trôi qua từ trận gần nhất CÓ TỶ SỐ. Trang phải đọc con số này mà
     *  hiển thị, đừng viết "cập nhật hôm nay" theo thời điểm dựng trang. */
    stalenessDays: factSet.stalenessDays,
    facts: factSet.facts,
    /** Lịch thi đấu sắp tới, giờ đã quy về Việt Nam. Hình dạng dữ liệu thứ
     *  hai bên cạnh `facts`; mục `kind: "fixtures"` của đặc tả đọc trường
     *  này. Mảng rỗng là câu trả lời hợp lệ — mùa đã đá hết. */
    upcoming: factSet.upcoming,
    /** Bảng xếp hạng đầy đủ của giải mà trang này thuộc về. Trang giải in cả
     *  bảng; trang đội cắt cửa sổ quanh chính nó. Không đi vào prompt. */
    standings: factSet.standings,
    /** Trận ĐÃ có tỷ số, mới nhất trước — ngược chiều với `upcoming`, xem
     *  `recentResults`. */
    results: factSet.results,
    /** null = chưa sinh. Bình thường, không phải lỗi. */
    interpretation: cached ? { text: cached.text, factsFingerprint: cached.factsFingerprint } : null,
    /** Đặc tả của LOẠI trang này, để publisher biết mục nào cần chỉ số nào mà
     *  không phải tải cả `entity-spec.json` cho một trang. */
    pageSpec: entityPageSpecFor(decodedVertical, parsed.axis),
  });
}
