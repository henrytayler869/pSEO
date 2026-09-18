import { prisma } from "@/lib/db/prisma";
import { getTrafficRankedMarkets } from "@/lib/queries/traffic-research";
import { getCachedInterpretation } from "@/lib/ai/generate";
import { buildFactSet } from "@/lib/ai/facts";
import { rankCandidates, summarize, type FillCandidate, type RankedCandidate, type FillSummary } from "@/lib/ai/fill-queue";

/**
 * Hàng đợi điền nội dung cho một niche.
 *
 * "Đã phục vụ được" hỏi ĐÚNG hàm mà endpoint hỏi — getCachedInterpretation —
 * chứ không hỏi "có hàng nào trong bảng không". Hai câu đó khác nhau kể từ khi
 * cache khoá theo factsFingerprint, và chỗ hỏi câu yếu hơn đã từng khiến
 * script sinh báo "đã có 127 | sẽ sinh 0" trong khi cổng canh báo 101 trang
 * mất chữ. Một định nghĩa, một nơi.
 *
 * Cái giá là chậm: mỗi ZIP một lần dựng fact set. Đó là giá đúng cho một màn
 * hình mở vài lần một ngày, và là giá SAI cho thứ chạy mỗi request — nên nó
 * nằm ở đây chứ không nằm trong một route handler.
 */

export interface FillQueue {
  vertical: string;
  summary: FillSummary;
  /** Đã xếp hạng, chỉ gồm thứ CHƯA phục vụ được. */
  pending: RankedCandidate[];
}

export async function buildFillQueue(vertical: string, limit = 400): Promise<FillQueue> {
  const markets = await getTrafficRankedMarkets(vertical);

  // Đã từng sinh đoạn ĐẠT cho ZIP nào — một truy vấn, không phải N.
  const everRows = await prisma.aiGeneration.findMany({
    where: { vertical, validationPassed: true },
    select: { zip: true },
    distinct: ["zip"],
  });
  const ever = new Set(everRows.map((r) => r.zip));

  const candidates: FillCandidate[] = [];
  for (const m of markets.slice(0, limit)) {
    /**
     * ZIP KHÔNG CÓ DỮ LIỆU THÌ KHÔNG VÀO HÀNG ĐỢI.
     *
     * Hàng đợi xếp theo lượng tìm trên MỌI ZIP đã nghiên cứu (582 với niche
     * này), còn trang chỉ tồn tại cho ZIP có dữ liệu thu được (184). Ba con số
     * đứng đầu hàng — Houston 77002, 77003, 77005 — đều không có trang.
     *
     * Đo 18/9/2026, lô thử 5 trang cho publisher thứ hai:
     *
     *   18 đoạn sinh ra, 3 "đạt", 15 trượt, $0,32
     *   15 trượt: [unsupported_number] "555" — model bịa số vì prompt không có
     *             sự kiện nào để bám
     *    3 "đạt": "No local measurements are available for ZIP 77002…" — đúng
     *             về sự thật, và vô dụng, vì trang đó không tồn tại
     *
     * Tức là 0 đoạn dùng được. Tiền chi cho hai loại rác.
     *
     * Lọc bằng CHÍNH buildFactSet, không bằng một danh sách riêng: hỏi câu yếu
     * hơn ("ZIP này có trong manifest không") là dựng định nghĩa thứ hai về
     * "trang nào tồn tại", và bản thứ hai là bản trôi lệch.
     */
    const factSet = await buildFactSet(vertical, m.zip);
    if (!factSet || factSet.facts.length === 0) continue;

    const served = (await getCachedInterpretation(vertical, m.zip)) !== null;
    candidates.push({
      zip: m.zip,
      city: m.city,
      state: m.state,
      mainKeyword: m.mainKeyword,
      searchVolume: m.searchVolume,
      served,
      // "Đã trả tiền rồi mất" khác hẳn "chưa làm bao giờ", và chúng dẫn tới
      // hai kết luận khác nhau về việc có gì đó đang hỏng.
      stale: !served && ever.has(m.zip),
    });
  }

  return { vertical, summary: summarize(candidates), pending: rankCandidates(candidates) };
}
