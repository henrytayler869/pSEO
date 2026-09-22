/**
 * Các trang của cùng một nghề có giống nhau quá không.
 *
 * ═══ HAI CÂU HỎI KHÁC NHAU, VÀ TRỤC ĐỊA LÝ CHỈ HỎI CÂU THỨ NHẤT ═══
 *
 * `lib/ai/distinctness.ts` so một đoạn MỚI với những đoạn đã từng phục vụ cho
 * CÙNG một ZIP. Đó là câu hỏi về nút "sinh lại": bản viết lại có thật sự khác
 * bản cũ không.
 *
 * Câu hỏi của nghề này là câu khác: 96 trang đội, mỗi trang một đoạn văn dựng
 * từ CÙNG một bộ 19 chỉ số, chỉ khác tên đội và các con số. Brief mục 4.2 nói
 * thẳng rủi ro — "1.752 bài mỗi mùa dựng từ một tỷ số sẽ rất giống nhau nếu
 * chỉ đổi tên đội và con số". Không phép kiểm nào đang trả lời câu đó: một
 * trang có thể khác mọi bản cũ CỦA CHÍNH NÓ mà vẫn giống hệt 95 trang kia.
 *
 * ═══ VÌ SAO KHÔNG DÙNG `longestSharedPhrase` ═══
 *
 * Nó chuẩn hoá bằng `replace(/[^a-z0-9\s]/g, " ")` — bỏ MỌI ký tự ngoài ASCII.
 * Với tiếng Việt, đó không phải "bỏ dấu câu", đó là băm chữ. Đo 22/9/2026:
 *
 *     "Arsenal FC đang đứng thứ 2 trên bảng xếp hạng với 12 điểm sau 5 trận"
 *     -> arsenal|fc|ang|ng|th|2|tr|n|b|ng|x|p|h|ng|v|i|12|i|m|sau|5|tr|n
 *
 * "bảng xếp hạng" thành sáu mẩu `b|ng|x|p|h|ng`. Hai hệ quả, cả hai đều làm
 * con số vô nghĩa:
 *
 *   1. ĐẾM PHỒNG. Một cụm 4 từ tiếng Việt đếm thành 8-9 "từ". `MAX_SHARED_RUN_
 *      WORDS = 16` được hiệu chỉnh trên tiếng Anh (đo được 0-13), nên áp lên
 *      tiếng Việt nó chặt gấp đôi ý định ban đầu.
 *   2. ĐỤNG GIẢ. Mẩu `ng` đến từ "đứng", "hạng", "bảng", "những" — bốn từ khác
 *      hẳn nhau gộp thành một token. Hai đoạn không liên quan vẫn có thể chia
 *      nhau một mạch dài.
 *
 * Cùng họ với lỗi dấu phẩy thập phân ở `entity-validate.ts`: một nguyên hàm
 * viết cho tiếng Anh, đem dùng cho tiếng Việt, và vẫn CHẠY — chỉ trả lời sai.
 * Không có gì đỏ lên.
 */

/**
 * Bỏ dấu nhưng GIỮ RANH GIỚI TỪ.
 *
 * "đang đứng" -> "dang dung", không phải " ang  ng". Đây là chỗ khác biệt duy
 * nhất so với bản tiếng Anh, và là toàn bộ lý do file này tồn tại.
 */
const LETTER_MAP: Record<string, string> = { đ: "d", Đ: "d" };

export function normaliseVi(text: string): string[] {
  return [...text]
    .map((ch) => LETTER_MAP[ch] ?? ch)
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Mạch từ dài nhất mà hai đoạn dùng chung, tính bằng TỪ tiếng Việt.
 *
 * Thuật toán giống bản tiếng Anh (n-gram rồi nới dài); chỉ đổi bộ chuẩn hoá.
 */
export function longestSharedPhraseVi(a: string, b: string, n: number): string | null {
  const ta = normaliseVi(a);
  const tb = normaliseVi(b);
  if (ta.length < n || tb.length < n) return null;

  const seen = new Set<string>();
  for (let i = 0; i + n <= tb.length; i++) seen.add(tb.slice(i, i + n).join(" "));

  let best: string | null = null;
  for (let i = 0; i + n <= ta.length; i++) {
    if (!seen.has(ta.slice(i, i + n).join(" "))) continue;
    let end = i + n;
    while (end < ta.length && seen.has(ta.slice(end - n + 1, end + 1).join(" "))) end++;
    const phrase = ta.slice(i, end).join(" ");
    if (!best || phrase.length > best.length) best = phrase;
  }
  return best;
}

export function wordCount(phrase: string | null): number {
  return phrase ? phrase.split(/\s+/).filter(Boolean).length : 0;
}

export interface CrossPageVerdict {
  ok: boolean;
  /** Mạch trùng dài nhất tìm được với BẤT KỲ trang nào khác. */
  worstPhrase: string | null;
  worstWords: number;
  /** Trang mang mạch đó, để đi đọc thẳng nó. */
  worstAgainst: string | null;
  comparedWith: number;
}

/**
 * Trần mạch trùng GIỮA CÁC TRANG, tính bằng từ tiếng Việt đã bỏ dấu.
 *
 * KHÔNG lấy lại 16 của trục địa lý: con số đó đo trên tiếng Anh, bằng một bộ
 * chuẩn hoá khác, cho một câu hỏi khác (sinh lại cùng một trang). Mượn nó về
 * đây sẽ là một ngưỡng trông như đã hiệu chỉnh mà thật ra chưa đo gì.
 *
 * ĐO ĐƯỢC TRÊN TOÀN BỘ DÂN SỐ, không ngoại suy. `entity:distinctness -- 96`
 * ngày 22/9/2026, cả 96 trang đội, 4.560 cặp:
 *
 *     nhỏ nhất 4  |  TRUNG VỊ 8  |  trung bình 9,0  |  lớn nhất 41
 *
 * Ba cỡ mẫu cho thấy vì sao không được ngoại suy: mẫu 8 ra cực đại 24, mẫu 24
 * ra 27, toàn bộ ra 41 — cực đại bò lên theo số cặp, trong khi trung vị lại
 * GIẢM (11 -> 9 -> 8). Đặt trần theo một mẫu nhỏ sẽ chặt dần một cách tình cờ.
 *
 * ═══ CÁI ĐUÔI LÀ TRÙNG SỐ, KHÔNG PHẢI TRÙNG KHUÔN ═══
 *
 * Cặp tệ nhất là VfB Stuttgart và Hamburger SV, cùng Bundesliga, chia nhau 41
 * từ: "chưa có trận nào giữ sạch lưới, trong 4 trận đã đá, toàn bộ 3 điểm đến
 * từ 2 trận trên sân nhà còn 2 trận sân khách mang về 0 điểm…". Hai đội có Y
 * HỆT một bộ số — cùng số trận, cùng điểm, cùng tách sân nhà/khách, cùng số
 * trận giữ sạch lưới. Đầu mùa thì chuyện đó thường.
 *
 * Không prompt nào sửa được điều đó mà không bịa: hai trang đang nói cùng một
 * sự thật. Chặn chúng sẽ để hai trang KHÔNG CÓ VĂN NÀO — tệ hơn hẳn một đoạn
 * trùng dài.
 *
 * ═══ NÊN CỔNG NÀY CANH TRUNG VỊ, KHÔNG CANH CÁI ĐUÔI ═══
 *
 * Trần 45 (trên cực đại đo được 41 một biên bốn từ) cố ý LỎNG: nó không phải
 * để bắt trùng do số trùng. Thứ nó bắt là một hồi quy khác hẳn — ai đó sửa
 * prompt và cả kho văn trở nên rập khuôn. Dạng hỏng ấy đẩy TRUNG VỊ lên, và
 * trung vị 8 trên 4.560 cặp là bằng chứng kho văn hôm nay KHÔNG rập khuôn.
 *
 * Nên khi chạy lại: nhìn trung vị trước, cực đại sau. Trung vị nhảy từ 8 lên
 * 20 là báo động thật; một cặp 41 từ thì không.
  */
export const MAX_CROSS_PAGE_RUN_WORDS = 45;

export function judgeCrossPageDistinctness(
  text: string,
  others: readonly { label: string; text: string }[],
  maxWords: number = MAX_CROSS_PAGE_RUN_WORDS,
  n = 4
): CrossPageVerdict {
  let worstPhrase: string | null = null;
  let worstWords = 0;
  let worstAgainst: string | null = null;

  for (const other of others) {
    const phrase = longestSharedPhraseVi(text, other.text, n);
    const words = wordCount(phrase);
    if (words > worstWords) {
      worstWords = words;
      worstPhrase = phrase;
      worstAgainst = other.label;
    }
  }

  return { ok: worstWords <= maxWords, worstPhrase, worstWords, worstAgainst, comparedWith: others.length };
}
