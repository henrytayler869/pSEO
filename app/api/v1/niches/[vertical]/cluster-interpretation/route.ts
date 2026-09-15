import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";
import { getCachedClusterText } from "@/lib/ai/cluster-generate";
import { clusterIdOf } from "@/lib/ai/cluster-facts";
import { fingerprintText } from "@/lib/ai/generate";

/**
 * GET /api/v1/niches/{vertical}/cluster-interpretation?zips=11201,11212,...
 *
 * Đoạn diễn giải cho một trang CỤM — trang gộp nhiều ZIP.
 *
 * Nhận danh sách ZIP thay vì một mã cụm, vì HAI BÊN không có chung một tên
 * cho cụm. Quy tắc gộp sống ở site (isPublishable, clusterKey theo từ khoá),
 * còn HQ chỉ biết tập ZIP. Guide §3.5 cũng ghi rõ mainKeyword đổi được, nên
 * một mã cụm dạng chuỗi từ khoá sẽ hỏng lặng lẽ vào lần sửa mẫu tiếp theo.
 * Tập ZIP là thứ duy nhất hai bên đều nói được và không tự đổi.
 *
 * CHỈ ĐỌC. Không có `?generate=1` như endpoint per-zip: sinh một đoạn cụm
 * tốn $0.02–0.08 và cần fact set dạng dải, nên nó là việc chủ động ở HQ
 * (`tsx scripts/generate-cluster-text.ts`), không phải hệ quả phụ của một
 * lần site dựng trang. Một trang bị crawl nhiều lần không được phép biến
 * thành hoá đơn.
 *
 * 404 khi chưa có đoạn nào cho tập ZIP đó. Site coi 404 là "chưa có" và
 * render không có đoạn — đúng như nó đang làm hôm nay.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/niches/[vertical]/cluster-interpretation">
) {
  const { vertical } = await ctx.params;

  // Phạm vi trước, dữ liệu sau: khoá của publisher này chỉ đọc được
  // niche của chính nó.
  const unauthorized = await requireApiKey(request, { vertical });
  if (unauthorized) return unauthorized;

  const raw = new URL(request.url).searchParams.get("zips") ?? "";
  const zips = raw.split(",").map((z) => z.trim()).filter(Boolean);

  if (zips.length === 0) {
    return apiJson({ error: "Thiếu tham số zips. Ví dụ: ?zips=11201,11212" }, { status: 400 });
  }
  // MỘT ZIP là hợp lệ, và guard cũ ở đây từng từ chối nó.
  //
  // Lý do cũ: "một ZIP thì dùng /markets/{zip}/interpretation". Lý do đó
  // đúng cho trang market và SAI cho hub của một bang chỉ publish một ZIP —
  // hub đó cần một khẳng định KHÁC (ZIP này đứng đâu trong toàn bộ tập đã
  // publish), và phục vụ đoạn của trang market ở đó là đăng trùng nội dung
  // giữa hub và trang con của nó.
  //
  // Đo 14/9/2026: 7 đoạn hub một-ZIP đã sinh xong và nằm trong DB, nhưng
  // guard này trả 400 nên không đoạn nào tới được site. Tính năng hoàn chỉnh
  // ở mọi tầng trừ một dòng điều kiện.
  // Từ chối cả lô khi có ZIP sai định dạng, không lọc bỏ rồi chạy tiếp: bỏ
  // một ZIP đi làm tập thành viên khác đi, tức là hỏi về MỘT CỤM KHÁC — và
  // câu trả lời sẽ mô tả một dải không phải dải của trang đang hỏi.
  const bad = zips.filter((z) => !/^\d{5}$/.test(z));
  if (bad.length > 0) {
    return apiJson({ error: `ZIP sai định dạng: ${bad.join(", ")}. Không bỏ qua, vì bỏ một ZIP là hỏi về một cụm khác.` }, { status: 400 });
  }

  const text = await getCachedClusterText(vertical, zips);
  if (!text) {
    return apiJson(
      {
        error: "Chưa có đoạn diễn giải cho tập ZIP này.",
        clusterId: clusterIdOf(vertical, zips),
        memberZips: [...zips].sort(),
        hint: "Sinh ở Head Quarter: tsx scripts/generate-cluster-text.ts",
      },
      { status: 404 }
    );
  }

  return apiJson({
    clusterId: clusterIdOf(vertical, zips),
    memberZips: [...zips].sort(),
    text,
    // Cùng ý nghĩa với textFingerprint của endpoint per-zip (guide §3.5):
    // site so nó để biết đoạn văn đã đổi mà không phải so cả chuỗi.
    textFingerprint: fingerprintText(text),
  });
}
