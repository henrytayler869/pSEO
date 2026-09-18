import { prisma } from "@/lib/db/prisma";
import { getTrafficRankedMarkets } from "@/lib/queries/traffic-research";
import { getCachedInterpretation } from "@/lib/ai/generate";
import { buildFactSet } from "@/lib/ai/facts";
import { fetchServedInventory } from "@/lib/publisher/inventory";
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
  /** Bị loại vì đoạn sinh ra sẽ không hiện trên trang nào. */
  excluded: { cluster: number; noPage: number; noData: number };
  /**
   * Không dựng được hàng đợi, và lý do. `pending` rỗng khi có giá trị.
   *
   * Tách khỏi "không còn gì để điền": hai thứ đó cùng cho zero và dẫn tới hai
   * kết luận ngược nhau.
   */
  unavailable?: string;
}

export async function buildFillQueue(
  site: { vertical: string; url: string },
  limit = 400
): Promise<FillQueue> {
  const { vertical } = site;
  const empty = { total: 0, served: 0, stale: 0, never: 0, estimatedUsd: 0 };
  const noExclusions = { cluster: 0, noPage: 0, noData: 0 };

  /**
   * TRANG NÀO TỒN TẠI LÀ CÂU HỎI CỦA PUBLISHER, KHÔNG PHẢI CỦA HQ.
   *
   * Bản trước lọc bằng buildFactSet, tức hỏi "ZIP này có DỮ LIỆU không". Câu
   * đó không phải câu cần hỏi, và chú thích ngay dưới đây đã gọi tên cái bẫy
   * ấy trước khi tôi bước vào nó.
   *
   * Đo 19/9/2026, lô 5 trang cho auto-accident-attorney: 5/5 đoạn ĐẠT, $0,0937
   * — và cả 5 ZIP (77036, 77084, 77095, 77379, 77386) cùng thuộc MỘT trang
   * cụm /auto-accident-attorney/tx/houston. Trang cụm dựng chữ từ đoạn CẤP
   * CỤM (lib/hq/cluster-interpretation.ts bên publisher), không đọc đoạn
   * per-ZIP. Năm đoạn hợp lệ, đúng sự thật, và không trang nào hiển thị.
   *
   * Đây là lần thứ hai trả tiền cho đúng bài học này — lib/publisher/inventory.ts
   * đã ghi lần thứ nhất: "$0.20 cho chữ không ai đọc", đo 13/9/2026, kèm câu
   * "Nơi nào sinh lại nội dung theo lô nên lọc theo trường này". Hàng đợi này
   * là nơi ĐẮT NHẤT trong hệ chưa lọc theo nó.
   *
   * Hỏng đường mạng thì KHÔNG rơi về "cho qua tất": chính cách rơi đó biến một
   * sự cố mạng thành một hoá đơn.
   */
  let inventory;
  try {
    inventory = await fetchServedInventory(site.url);
  } catch (err) {
    return {
      vertical,
      summary: empty,
      pending: [],
      excluded: noExclusions,
      unavailable:
        `Không đọc được /api/inventory của ${site.url}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Chưa biết ZIP nào có trang riêng thì chưa điền — đoạn sinh cho ZIP thuộc trang cụm không hiện ở đâu cả.`,
    };
  }

  const markets = await getTrafficRankedMarkets(vertical);

  // Đã từng sinh đoạn ĐẠT cho ZIP nào — một truy vấn, không phải N.
  const everRows = await prisma.aiGeneration.findMany({
    where: { vertical, validationPassed: true },
    select: { zip: true },
    distinct: ["zip"],
  });
  const ever = new Set(everRows.map((r) => r.zip));

  const excluded = { cluster: 0, noPage: 0, noData: 0 };
  const candidates: FillCandidate[] = [];
  for (const m of markets.slice(0, limit)) {
    const kind = inventory.kindByZip.get(m.zip);
    if (kind === undefined) {
      excluded.noPage++;
      continue;
    }
    if (kind === "cluster") {
      excluded.cluster++;
      continue;
    }

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
     * Vẫn giữ SAU phép lọc theo tồn kho: tồn kho nói trang có tồn tại không,
     * fact set nói có gì để viết không. Một trang tồn tại mà rỗng sự kiện vẫn
     * sinh ra đúng loại rác thứ nhất.
     */
    const factSet = await buildFactSet(vertical, m.zip);
    if (!factSet || factSet.facts.length === 0) {
      excluded.noData++;
      continue;
    }

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

  return { vertical, summary: summarize(candidates), pending: rankCandidates(candidates), excluded };
}
