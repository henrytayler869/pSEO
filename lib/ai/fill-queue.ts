/**
 * Thứ tự điền nội dung, và phần quyết định của nó tách khỏi phần truy vấn.
 *
 * Yêu cầu là "xác nhận việc điền theo các keyword QUAN TRỌNG trước". Nên phần
 * khó không phải vòng lặp sinh — nó đã chạy thật — mà là định nghĩa "quan
 * trọng", và làm cho định nghĩa đó nhìn thấy được trước khi tiêu tiền.
 */

export interface FillCandidate {
  zip: string;
  city: string | null;
  state: string;
  mainKeyword: string | null;
  searchVolume: number | null;
  /** Đường phục vụ có trả chữ cho ZIP này không. */
  served: boolean;
  /** Đã từng sinh đoạn đạt nhưng không còn dùng được — tiền đã tiêu, chữ
   *  không tới nơi. Khác hẳn "chưa làm bao giờ". */
  stale: boolean;
}

export interface RankedCandidate extends FillCandidate {
  rank: number;
  /** Lý do xếp hạng này, hiện thẳng trên màn hình. Một thứ tự không giải
   *  thích được là một thứ tự người ta sẽ bỏ qua rồi bấm "điền hết". */
  why: string;
}

/**
 * Xếp theo LƯỢNG TÌM KIẾM giảm dần, ZIP chưa có chữ lên trước.
 *
 * Vì sao lượng tìm kiếm chứ không phải điểm traffic tổng hợp: điểm là một
 * con số đã trộn nhiều yếu tố và không ai đọc được từ màn hình vì sao ZIP này
 * đứng trên ZIP kia. Lượng tìm kiếm là thứ đo trực tiếp, và câu "trang này
 * đáng điền trước vì 2.400 lượt/tháng" tự nó là lời giải thích.
 *
 * ZIP không có số đo từ khoá xuống CUỐI, không bị loại. Thiếu số đo không có
 * nghĩa là không có nhu cầu — nó có nghĩa là chưa ai đo. Loại chúng đi sẽ
 * khiến một nhóm thị trường biến mất khỏi hàng đợi mà không ai biết.
 */
export function rankCandidates(candidates: FillCandidate[]): RankedCandidate[] {
  const pending = candidates.filter((c) => !c.served);
  const sorted = [...pending].sort((a, b) => {
    const av = a.searchVolume ?? -1;
    const bv = b.searchVolume ?? -1;
    if (av !== bv) return bv - av;
    return a.zip.localeCompare(b.zip);
  });
  return sorted.map((c, i) => ({
    ...c,
    rank: i + 1,
    why:
      c.searchVolume === null || c.searchVolume < 0
        ? "chưa đo từ khoá — xếp cuối, không loại"
        : c.stale
          ? `${c.searchVolume.toLocaleString("vi-VN")} lượt/tháng · đã trả tiền, chữ không tới nơi`
          : `${c.searchVolume.toLocaleString("vi-VN")} lượt/tháng`,
  }));
}

export interface FillSummary {
  total: number;
  served: number;
  stale: number;
  never: number;
  /** Chi phí ước tính cho phần CHƯA phục vụ được, USD. */
  estimatedUsd: number;
}

/**
 * Giá trung bình một đoạn, đo trên 183 đoạn đã trả tiền thật cho
 * moving-services ngày 16/9/2026: trung bình $0,0191, p90 $0,0237.
 *
 * Dùng p90 chứ không phải trung bình. Một ước tính thấp hơn thực tế sẽ khiến
 * người bấm nút phát hiện ra mình vượt ngân sách SAU khi đã tiêu — thứ tự tệ
 * nhất có thể. Ước cao rồi tiêu ít hơn thì không ai thiệt.
 */
export const COST_PER_PASSAGE_USD = 0.0237;

export function summarize(candidates: FillCandidate[]): FillSummary {
  const served = candidates.filter((c) => c.served).length;
  const stale = candidates.filter((c) => !c.served && c.stale).length;
  const never = candidates.filter((c) => !c.served && !c.stale).length;
  return {
    total: candidates.length,
    served,
    stale,
    never,
    estimatedUsd: Number(((stale + never) * COST_PER_PASSAGE_USD).toFixed(4)),
  };
}

export type BudgetVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Điền hết có vượt ngân sách publisher không.
 *
 * Trả lời TRƯỚC khi tiêu, không phải sau. Ngân sách ở đây là MỀM theo thiết
 * kế — nội dung phụ thuộc hoàn toàn vào AI nên chặn cứng chỉ dừng sản phẩm —
 * nên hàm này không cấm, nó CẢNH BÁO và bắt người bấm xác nhận lần nữa.
 *
 * `budgetUsd` null nghĩa là chưa đặt ngân sách, và đó KHÔNG phải "không giới
 * hạn": nó là "chưa ai quyết", và câu trả lời đúng là nói ra điều đó chứ
 * không lặng lẽ cho qua.
 */
export function judgeFillBudget(params: {
  budgetUsd: number | null;
  spentUsd: number;
  estimatedUsd: number;
}): BudgetVerdict {
  const { budgetUsd, spentUsd, estimatedUsd } = params;
  if (budgetUsd === null) {
    return { ok: false, reason: "Publisher này chưa đặt ngân sách AI, nên không có gì để so. Đặt ngân sách rồi điền." };
  }
  const after = spentUsd + estimatedUsd;
  if (after > budgetUsd) {
    return {
      ok: false,
      reason:
        `Điền hết ước tính $${estimatedUsd.toFixed(2)}, cộng $${spentUsd.toFixed(2)} đã tiêu thành ` +
        `$${after.toFixed(2)} — vượt ngân sách $${budgetUsd.toFixed(2)}.`,
    };
  }
  return { ok: true };
}
