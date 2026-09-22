import { ROUNDING_TOLERANCE } from "@/lib/ai/validate";
import type { FootballFact } from "@/lib/football/facts";

/**
 * Validator cho văn bản viết về một thực thể (đội / giải / cặp đối đầu).
 *
 * ═══ DÙNG LẠI NGUYÊN HÀM, KHÔNG CHÉP LUẬT ═══
 *
 * `ROUNDING_TOLERANCE` import từ validator địa lý. Đó là CHÍNH SÁCH — sai số
 * bao nhiêu thì còn chấp nhận được — và nó không được phép có hai bản. Kho
 * này đã trả giá đúng chỗ đó: HQ chấp nhận một con số lệch 0,5% trong khi
 * site chỉ chấp nhận đúng cách làm tròn nó đã in, và một đoạn văn rơi vào
 * giữa sẽ qua bên này, tốn tiền, được cache, rồi bị bên kia bỏ — trang mất
 * đoạn diễn giải mà không có lỗi ở đâu nối hai nửa lại.
 *
 * `extractNumbers` thì KHÔNG dùng lại được, và đây không phải chuyện khẩu vị.
 * Nó đọc "," là dấu phân nhóm nghìn, đúng với tiếng Anh. Tiếng Việt dùng ","
 * làm dấu THẬP PHÂN và "." làm dấu nhóm nghìn — ngược hẳn. Đo 22/9/2026 bằng
 * chính hàm đó:
 *
 *     "52,0%"  -> 520      (phải là 52)
 *     "8,5%"   -> 85       (phải là 8,5)
 *     "1.234"  -> 1.234    (phải là 1234)
 *
 * Lệch đúng 10 lần. Hậu quả không phải là vài cờ đỏ sai: MỌI phần trăm mà
 * model trích đúng sẽ bị từ chối là "số không có trong fact", nên mỗi trang
 * có tỷ lệ sẽ trượt cả hai lượt thử rồi KHÔNG CÓ VĂN NÀO. Và chiều ngược lại
 * tệ hơn — 520 có thể tình cờ khớp một chỉ số khác và được cho qua.
 *
 * Thứ KHÔNG dùng lại được là `validateGeneratedText`: nó hỏi "số này có được
 * phép gán cho ZIP không" và đọc `factSet.zip`, `.state`, `.county`. Câu hỏi
 * tương ứng ở đây là "số này có được phép gán cho ĐỘI không", và tập phạm vi
 * là TEAM / LEAGUE / FIXTURE.
 */

/**
 * Tập luật RIÊNG, không nối thêm vào `VALIDATOR_RULES`.
 *
 * Union bên kia được CÔNG BỐ trong registry content-rules, tức nó là hợp đồng
 * mà mọi publisher đọc. Nhét "cá cược" và "kiến tạo" vào đó là đẩy từ vựng
 * bóng đá vào hợp đồng của hai site không liên quan gì tới bóng đá.
 *
 * Ba tên ĐƯỢC dùng lại — `unsupported_number`, `scope_overclaim`,
 * `worded_proportion` — vì ở đó luật thật sự là cùng một luật, chỉ đổi phạm
 * vi. Đặt tên mới cho cùng một luật sẽ là nói rằng chúng khác nhau.
 */
export type EntityValidatorRule =
  | "unsupported_number"
  | "scope_overclaim"
  | "worded_proportion"
  | "unsupported_claim"
  | "betting_or_prediction";

export interface EntityValidationIssue {
  rule: EntityValidatorRule;
  detail: string;
}

export interface EntityValidationResult {
  passed: boolean;
  issues: EntityValidationIssue[];
}

/**
 * Từ vựng mô tả thứ KHÔNG nguồn nào trong tay đo được.
 *
 * Không phải danh sách khẩu vị. Mỗi từ ở đây đặt tên cho một loại dữ liệu mà
 * `EntityContentSpec.unavailable` ghi rõ là không tồn tại — người ghi bàn,
 * phút ghi bàn, kiến tạo, thẻ, đội hình, kiểm soát bóng, số cú sút. Một câu
 * chứa chúng KHÔNG THỂ dựa trên fact nào, nên sự có mặt của chúng là dấu hiệu
 * bịa, không phải dấu hiệu văn phong.
 *
 * Luật 1 (mọi số phải truy được về fact) KHÔNG bắt được nhóm này, vì một câu
 * bịa dạng "hàng thủ chơi tập trung, chỉ để thủng lưới sau các pha phản công"
 * không nêu số nào. Đó là lý do luật này tồn tại riêng.
 */
const UNSUPPORTED_TERMS: readonly { term: string; why: string }[] = [
  { term: "kiến tạo", why: "nguồn không có dữ liệu kiến tạo" },
  { term: "thẻ vàng", why: "nguồn không có thẻ phạt" },
  { term: "thẻ đỏ", why: "nguồn không có thẻ phạt" },
  { term: "đội hình xuất phát", why: "nguồn không có đội hình ra sân" },
  { term: "đội hình ra sân", why: "nguồn không có đội hình ra sân" },
  { term: "thay người", why: "nguồn không có thay người" },
  { term: "kiểm soát bóng", why: "nguồn không có số liệu kiểm soát bóng" },
  { term: "cú sút", why: "nguồn không có số cú sút" },
  { term: "phạt góc", why: "nguồn không có số phạt góc" },
  { term: "phút thứ", why: "nguồn không có phút ghi bàn" },
  { term: "chấn thương", why: "nguồn không có thông tin chấn thương" },
  { term: "chuyển nhượng", why: "nguồn không có dữ liệu chuyển nhượng" },
];

/**
 * Từ vựng CÁ CƯỢC và DỰ ĐOÁN.
 *
 * Luật này tồn tại vì chính hình dạng dữ liệu mời gọi nó: "tỷ lệ trận trên
 * 2,5 bàn" và "hai đội cùng ghi bàn" là TÊN HAI KÈO CƯỢC. Một model được đưa
 * hai chỉ số đó mà không bị cấm gì sẽ trôi sang giọng của một trang soi kèo,
 * và nó sẽ trôi một cách hoàn toàn trôi chảy.
 *
 * Nội dung đã chốt là nhận định SAU trận và số liệu đọc quanh năm (brief mục
 * 4.2), không phải dự đoán trước trận. Một câu dự đoán còn là lời hứa về kết
 * quả — thứ mà luật `no-outcome-claims` của registry cấm ở nghề khác vì cùng
 * một lý do.
 */
const BETTING_TERMS: readonly string[] = [
  "kèo", "cá cược", "đặt cược", "nhà cái", "soi kèo", "tỷ lệ cược",
  "dự đoán", "nhận định trước trận", "chắc chắn thắng", "cửa trên", "cửa dưới",
];

/** Tỷ lệ viết bằng CHỮ. Cùng luật với validator địa lý: nếu muốn nêu một
 *  phần, dùng đúng con số đã đo. */
const WORDED_PROPORTIONS: readonly string[] = [
  "một nửa", "một phần ba", "hai phần ba", "một phần tư", "ba phần tư", "đa số", "phần lớn số trận",
];

/**
 * Đọc số ra khỏi văn bản theo quy ước TIẾNG VIỆT.
 *
 * "." phân nhóm nghìn, "," là dấu thập phân — ngược với bản tiếng Anh. Xem
 * khối đầu file để biết vì sao đây là hàm riêng chứ không phải một lần dùng
 * lại bị bỏ lỡ.
 */
export function extractNumbersVi(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];

  /**
   * Mùa giải "2026-27" là MỘT token, không phải hai số.
   *
   * Không che nó trước thì biểu thức đọc ra 2026 và -27: dấu nối thành dấu
   * trừ, và -27 không khớp chỉ số nào nên mọi câu nhắc tên mùa đều bị từ
   * chối. Mà trang thì buộc phải nói mùa nào — thiếu nó, con số mất mốc thời
   * gian.
   *
   * Che bằng khoảng trắng cùng độ dài để các vị trí phía sau không xê dịch.
   */
  const masked = text.replace(/\b(\d{4})-\d{2}\b/g, (m, year: string) => {
    out.push({ raw: m, value: Number(year) });
    return " ".repeat(m.length);
  });

  // KHÔNG nhận dấu trừ đứng trước: không chỉ số bóng đá nào ở tầng này mang
  // giá trị âm (điểm, bàn, số trận, thứ hạng đều không âm), nên một dấu trừ
  // trong văn bản là dấu nối chứ không phải dấu âm. Validator địa lý thì
  // ngược lại và có lý do riêng — di cư ròng âm thật.
  for (const m of masked.matchAll(/\d[\d.]*(?:,\d+)?%?/g)) {
    const raw = m[0];
    // Bỏ dấu nhóm nghìn TRƯỚC, rồi đổi dấu thập phân. Làm ngược thứ tự thì
    // "1.234,5" thành "1.234.5" và Number() trả NaN.
    const value = Number(raw.replace(/%/g, "").replace(/\./g, "").replace(/,/g, "."));
    if (Number.isFinite(value)) out.push({ raw, value });
  }
  return out;
}

function matchesAnyFact(value: number, facts: readonly FootballFact[]): FootballFact[] {
  return facts.filter((f) => {
    if (f.value === value) return true;
    if (f.value === 0) return false;
    return Math.abs(f.value - value) / Math.abs(f.value) <= ROUNDING_TOLERANCE;
  });
}

/**
 * Câu chứa số đó, cắt theo dấu câu chứ không theo số ký tự.
 *
 * Một cửa sổ ký tự vắt qua dấu chấm và cho hai mệnh đề không liên quan "nhìn
 * thấy" nhau — cùng bẫy mà validator địa lý đã ghi lại.
 */
function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/**
 * Chữ ĐẶC TRƯNG của một nhãn, để nhận ra câu đang nói về chính chỉ số đó.
 *
 * Tách theo chữ cái Unicode chứ không theo [a-z]: nhãn ở đây là tiếng Việt có
 * dấu, và một biểu thức chỉ biết a-z sẽ cắt "trận" thành "tr" và "n".
 */
const LABEL_STOPWORDS = new Set([
  "của", "số", "và", "trên", "các", "đã", "một", "cho", "với", "trong", "tỷ", "lệ",
]);

function labelCues(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !LABEL_STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Số nằm trong CHÍNH NHÃN của một chỉ số cũng là số đo được.
 *
 * Luật 1 lọc theo GIÁ TRỊ. Nhưng nhãn cũng chứa số, và một câu nhắc lại nhãn
 * buộc phải nhắc số đó: "tỷ lệ trận trên 2,5 bàn" — con số 2,5 là NGƯỠNG nằm
 * trong tên chỉ số, không phải một giá trị đo được. Không có miễn trừ này thì
 * mọi câu nói về tài xỉu đều bị từ chối, và đó là chỉ số trung tâm của cả
 * niche.
 *
 * Bẫy y hệt đã xảy ra ở trục địa lý: 5/5 đoạn của nghề tai nạn bị từ chối vì
 * "16" và "60" trong "workers aged 16 and over".
 *
 * VÀ CHỈ MIỄN KHI SỐ ĐỨNG CÙNG CÂU VỚI CHỮ CỦA CHÍNH NHÃN ĐÓ. Miễn trừ trần
 * trụi ("số này có trong một nhãn nào đó") mở một lỗ: một câu bịa dùng đúng
 * con số ngưỡng ở một chỗ hoàn toàn khác sẽ đi qua.
 *
 * GIỚI HẠN ĐÃ BIẾT, ghi ra chứ không giấu: chữ đặc trưng của nhãn bóng đá rất
 * ngắn ("trận", "bàn") nên một câu sai vẫn có thể chứa chúng. Đây là cùng
 * đánh đổi mà validator địa lý đã chấp nhận, và luật 3 (từ vựng không nguồn
 * nào đo) là lớp chắn thứ hai cho đúng khoảng trống này.
 */
function numberIsInItsOwnLabel(value: number, sentence: string, facts: readonly FootballFact[]): boolean {
  const lower = sentence.toLowerCase();
  for (const f of facts) {
    if (!extractNumbersVi(f.label).some((n) => n.value === value)) continue;
    if (labelCues(f.label).some((cue) => lower.includes(cue))) return true;
  }
  return false;
}

/**
 * Năm dương lịch, để model viết được "mùa 2026-27".
 *
 * Mùa giải KHÔNG phải một phép đo, nên nó không có mặt trong fact set — mà
 * trang thì buộc phải nói mùa nào, nếu không con số mất mốc thời gian. Khoảng
 * hẹp và tường minh, chứ không phải một danh sách số nhỏ được tha bổng chung:
 * ở nghề này 3, 5, 12 đều là những con số mang khẳng định thật (bàn, trận,
 * điểm), nên tha chúng sẽ mở đúng cánh cửa mà luật 1 sinh ra để đóng.
 */
function isCalendarYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

export interface EntityValidateOptions {
  /**
   * Axis của TRANG đang chấm.
   *
   * Luật scope_overclaim chỉ có nghĩa khi chủ thể của trang KHÁC phạm vi của
   * con số. Trên trang GIẢI, mọi chỉ số đều cấp giải và chủ thể chính là giải
   * đó — đòi nêu tên giải trong từng câu là đòi một điều thừa, và văn đúng sẽ
   * bị từ chối.
   *
   * Đo 22/9/2026 khi sinh lô: CẢ 5 trang giải trượt, mỗi trang 2-3 lần, trong
   * khi văn hoàn toàn đúng — "Mùa 2026-27 của Ngoại hạng Anh hiện đã có 50
   * trận. Trong số 50 trận này, tỷ lệ trận có trên 2,5 bàn là 52,0%." Câu hai
   * không lặp tên giải vì câu một đã nêu.
   *
   * Chính lý lẽ của luật đã nói ra giới hạn ấy — "Trên trang một ĐỘI, con số
   * đó sẽ đọc ra là số của đội" — và mã không đọc theo.
   */
  pageAxis?: string;
  /**
   * Tên giải, để che khi đọc số.
   *
   * Phải truyền RIÊNG, không suy được từ fact: trên trang đội, `modelFacts` đã
   * lọc hết chỉ số cấp giải, nên không `scopeName` nào còn mang tên giải — dù
   * câu văn vẫn buộc phải nêu nó. Đo 22/9/2026: hai trang Ligue 1 vẫn trượt
   * sau khi đã che tên riêng, vì "Ligue 1" không còn ở đâu để che.
   *
   * Đây là cái giá của việc tách facts/modelFacts, và nó chỉ lộ ra ở giải có
   * chữ số trong tên.
   */
  leagueName?: string;
}

export function validateEntityText(
  text: string,
  facts: readonly FootballFact[],
  opts: EntityValidateOptions = {}
): EntityValidationResult {
  const issues: EntityValidationIssue[] = [];
  const lower = text.toLowerCase();

  /**
   * Che TÊN RIÊNG trước khi đọc số.
   *
   * "Ligue 1" chứa một chữ số, và nó là TÊN — không phải một phép đo. Đo
   * 22/9/2026: trang Paris FC bị từ chối vì số "1", lấy từ chính tên giải mà
   * câu văn buộc phải nêu. Ba đội Pháp khác trượt cùng lý do.
   *
   * Lấy tên từ `scopeName` của chính fact set, không từ một danh sách viết
   * tay: tên ở đó do HQ cấp, nên không có nguồn thứ hai để trôi lệch.
   */
  const names = [...new Set([...facts.map((f) => f.scopeName), opts.leagueName ?? ""])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const masked = names.reduce(
    (acc, n) => (n ? acc.split(n).join(" ".repeat(n.length)) : acc),
    text
  );

  // ── Luật 1: mọi số phải truy được về một fact đã đo ─────────────────────
  for (const sentence of sentencesOf(masked)) {
    for (const { raw, value } of extractNumbersVi(sentence)) {
      if (matchesAnyFact(value, facts).length > 0) continue;
      if (isCalendarYear(value)) continue;
      if (numberIsInItsOwnLabel(value, sentence, facts)) continue;
      issues.push({
        rule: "unsupported_number",
        detail: `Số "${raw}" không khớp chỉ số nào đã đo. Chỉ được nêu số có trong danh sách.`,
      });
    }
  }

  // ── Luật 2: số cấp GIẢI phải tự nói ra là số cấp giải ───────────────────
  //
  // Bản dịch của `aggregate-must-declare-scope`. Một con số của cả giải in
  // trên trang một đội, không kèm tên giải, đọc ra là số của đội đó.
  // Trang GIẢI: chủ thể ĐÃ là giải, không có chỗ nào để gán nhầm. Xem
  // EntityValidateOptions.pageAxis.
  const checkScope = opts.pageAxis !== "league";
  // Đọc SỐ trên bản đã che tên riêng, nhưng kiểm TÊN trên bản gốc: che giữ
  // nguyên độ dài nên hai bản cắt câu ra cùng số mảnh và khớp theo chỉ số.
  // Dùng bản che cho cả hai việc sẽ xoá mất chính cái tên mà luật đi tìm.
  const originalSentences = sentencesOf(text);
  const maskedSentences = sentencesOf(masked);
  for (let si = 0; checkScope && si < maskedSentences.length; si++) {
    const sentence = originalSentences[si] ?? maskedSentences[si];
    for (const { value } of extractNumbersVi(maskedSentences[si])) {
      const hits = matchesAnyFact(value, facts);
      if (hits.length === 0) continue;
      // Chỉ xét khi MỌI fact khớp con số này đều ở cấp giải — còn nếu có một
      // fact cấp đội cũng mang giá trị đó thì câu có thể đang nói về đội, và
      // báo lỗi sẽ là một cờ đỏ sai.
      if (!hits.every((f) => f.scope === "LEAGUE")) continue;
      const names = [...new Set(hits.map((f) => f.scopeName))];
      const declares = names.some((n) => sentence.toLowerCase().includes(n.toLowerCase()));
      if (!declares) {
        issues.push({
          rule: "scope_overclaim",
          detail:
            `Câu "${sentence.trim().slice(0, 90)}…" dùng một con số ở cấp GIẢI mà không nêu tên giải ` +
            `(${names.join(" / ")}). Trên trang một đội, con số đó sẽ đọc ra là số của đội.`,
        });
      }
    }
  }

  // ── Luật 3: không nói về thứ không nguồn nào đo ─────────────────────────
  for (const { term, why } of UNSUPPORTED_TERMS) {
    if (lower.includes(term)) {
      issues.push({
        rule: "unsupported_claim",
        detail: `Văn bản nhắc "${term}" — ${why}. Không fact nào chống lưng được câu này.`,
      });
    }
  }

  // ── Luật 4: không giọng cá cược, không dự đoán ──────────────────────────
  for (const term of BETTING_TERMS) {
    if (lower.includes(term)) {
      issues.push({
        rule: "betting_or_prediction",
        detail:
          `Văn bản nhắc "${term}". Nội dung là nhận định SAU trận và số liệu đọc quanh năm, không phải ` +
          "dự đoán hay soi kèo — dù hai chỉ số tài xỉu và hai đội cùng ghi bàn vốn là tên hai kèo cược.",
      });
    }
  }

  // ── Luật 5: tỷ lệ phải là con số đã đo, không phải chữ ──────────────────
  for (const term of WORDED_PROPORTIONS) {
    if (lower.includes(term)) {
      issues.push({
        rule: "worded_proportion",
        detail: `Văn bản viết tỷ lệ bằng chữ ("${term}"). Dùng đúng con số đã đo.`,
      });
    }
  }

  return { passed: issues.length === 0, issues };
}
