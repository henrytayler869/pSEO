import { longestSharedPhrase } from "@/lib/article-qc/checklist";

/**
 * Đo xem một đoạn văn mới có thật sự khác những đoạn đã từng phục vụ cho
 * cùng ZIP hay không.
 *
 * Tồn tại vì một phép đo đã bác bỏ cách làm hiển nhiên. Sinh lại ZIP 95020
 * với CÙNG fact set và CÙNG prompt, temperature mặc định 1.0: bản mới chia
 * sẻ một mạch 47 TỪ LIÊN TIẾP với bản cũ trên tổng 180 từ. Một nút "sinh
 * lại" không kèm phép đo này sẽ báo thành công trong khi 26% nguyên văn đi
 * thẳng lên site mới.
 *
 * So với MỌI bản đã từng đạt, không chỉ bản mới nhất: lần dựng lại thứ hai
 * phải khác cả hai lần trước, và chỉ so với bản gần nhất sẽ cho phép văn
 * bản dao động qua lại giữa hai cách viết.
 */

/**
 * Độ dài mạch trùng tối đa chấp nhận được, tính bằng từ.
 *
 * ĐO ĐƯỢC, không chọn cho đẹp. scripts/measure-regen-distinctness.ts chạy
 * 5 ZIP với khối avoidBlock, ngưỡng để Infinity:
 *
 *   95020: 7  |  92563: 9  |  95630: 0  |  78572: 6  |  30024: 13
 *   nhỏ nhất 0, giữa 7, lớn nhất 13   (không có khối này: 47)
 *
 * Mọi phần còn trùng đều là mệnh đề BẮT BUỘC nêu số — "from abroad and 224
 * from another state", "median home value of 491 400". Đoạn văn phải nêu
 * cùng những con số và cùng tên địa danh, nên một mức trùng nền không tránh
 * được.
 *
 * Chọn 16: trên mức lớn nhất đo được (13) một biên ba từ. Lý do nghiêng về
 * phía lỏng chứ không phía chặt — trần quá chặt thì một ZIP mà fact set
 * buộc phải có mạch dài sẽ trượt cả bốn lần và KHÔNG CÓ VĂN NÀO, tệ hơn hẳn
 * một mạch 14 từ toàn số. Thứ cần chặn là bản 47 từ: một đoạn viết lại mà
 * vẫn là chính nó.
 *
 * Mẫu 5 ZIP là nhỏ; biên ba từ và vòng thử lại là chỗ hấp thụ sai số đó.
 * Thấy nhiều ca trượt vì not-distinct thì đo lại rồi chỉnh, đừng nâng trần
 * cho khuất mắt.
 */
export const MAX_SHARED_RUN_WORDS = 16;

/** Ngắn hơn mức này thì không đáng gọi là mạch trùng. */
const MIN_RUN = 4;

export interface DistinctnessVerdict {
  ok: boolean;
  /** Mạch trùng dài nhất tìm được trên tất cả bản cũ. Null = không có mạch nào >= MIN_RUN. */
  worstPhrase: string | null;
  worstWords: number;
  comparedWith: number;
}

export function judgeDistinctness(
  text: string,
  priorTexts: string[],
  maxWords: number = MAX_SHARED_RUN_WORDS
): DistinctnessVerdict {
  let worstPhrase: string | null = null;
  let worstWords = 0;

  for (const prior of priorTexts) {
    const phrase = longestSharedPhrase(text, prior, MIN_RUN);
    if (!phrase) continue;
    const words = phrase.split(/\s+/).filter(Boolean).length;
    if (words > worstWords) {
      worstWords = words;
      worstPhrase = phrase;
    }
  }

  // Không có bản cũ nào thì không có gì để trùng — và đó là "đạt", không
  // phải "chưa kiểm được". Lần sinh đầu tiên của một ZIP đi qua đây.
  return { ok: worstWords <= maxWords, worstPhrase, worstWords, comparedWith: priorTexts.length };
}

/**
 * Khối chỉ dẫn đưa văn bản CŨ vào prompt.
 *
 * Đưa nguyên văn chứ không tóm tắt: model cần biết chính xác chuỗi chữ nào
 * không được lặp lại. Và nói rõ phần nào BẮT BUỘC giữ — các con số — vì một
 * lệnh "viết khác đi" trần trụi sẽ được thi hành bằng cách đổi số, đúng thứ
 * validator cấm và đúng thứ phá hỏng trang.
 */
export function avoidBlock(priorTexts: string[]): string {
  if (priorTexts.length === 0) return "";
  const listed = priorTexts.map((t, i) => `--- BẢN CŨ ${i + 1} ---\n${t}`).join("\n\n");
  return `

PREVIOUSLY PUBLISHED TEXT FOR THIS SAME ZIP — DO NOT REUSE ITS WORDING

${listed}

The text above was published before and may still be indexed by Google. Write something that states the same facts in a genuinely different way:
- Do not reuse any run of ${MAX_SHARED_RUN_WORDS} or more consecutive words from it.
- Change the ORDER in which you introduce the figures, and change which figures you place side by side.
- Change the sentence shapes. If the old text listed arrivals as a comma series, do not write a comma series.

The FIGURES themselves must stay identical — same numbers, same scope wording. Only the prose around them changes. Changing a number to look different is a rejected draft, not a rewrite.`;
}
