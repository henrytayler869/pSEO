/**
 * Hai luật Technical SEO mà Head Quarter KIỂM ĐƯỢC TỪ XA.
 *
 * TẠI SAO CHỈ CÓ HAI
 *
 * Phần lớn technical SEO là phần TRÌNH BÀY và thuộc về publisher: URL, title,
 * internal link, cache, cấu trúc route. HQ giữ HỢP ĐỒNG — thứ phải giống nhau
 * ở mọi publisher. Nhét một luật trình bày vào endpoint hợp đồng chỉ tạo thêm
 * một luật khai báo mà không ai chứng minh được là nó đang chạy, tức là làm
 * rộng thêm đúng lỗ hổng mà `provenBy` sinh ra để bịt.
 *
 * Hai luật dưới đây qua được cửa đó vì cả hai đều đọc được từ HTML công khai
 * bằng một request HTTP — cùng mô hình lib/publisher/required-pages.ts.
 *
 * VÀ TẠI SAO LÀ JSON-LD
 *
 * Luật "displayed-only" của HQ (rounding.policy) đang chặn model bịa chữ số
 * trong VĂN BẢN. Nó dừng ở ranh giới HTML. JSON-LD là bề mặt còn lại, không ai
 * kiểm, và là bề mặt duy nhất được viết RA CHO MÁY ĐỌC — nên một con số bịa
 * chữ số ở đó đi thẳng vào Dataset Search và mọi thứ tiêu thụ schema, không
 * qua mắt người nào.
 *
 * Đo trên atmovingservices.com 2026-09-10: 96/225 PropertyValue công bố chuỗi
 * chữ số không xuất hiện ở bất kỳ đâu trên trang.
 */

/** Một mục variableMeasured, đúng phần luật này đụng tới. */
export interface MeasuredValue {
  name?: string;
  value: number | string;
  unitText?: string;
  measurementTechnique?: string;
}

export interface RuleVerdict {
  passed: boolean;
  /** Vì sao — để một verdict fail nói được phải sửa gì, không chỉ nói là sai. */
  reason: string;
}

/**
 * Cách một con số có thể XUẤT HIỆN với người đọc.
 *
 * Không so chuỗi thô, vì trang in "$372,100" còn JSON-LD ghi 372100 — hai cách
 * viết của cùng một con số, và coi đó là lệch sẽ khiến luật kêu ở mọi trang rồi
 * bị tắt đi. Cái luật này săn là con số mà KHÔNG cách in nào của nó có trên
 * trang.
 *
 * RANH GIỚI QUAN TRỌNG, và bản đầu tiên của hàm này đã vượt qua nó: được phép
 * THÊM chữ số 0 ở cuối (46 in thành "46.0"), KHÔNG được phép BỚT chữ số
 * (15.77459714851814 in thành "15.8"). Bản đầu sinh mọi độ chính xác ngắn hơn,
 * nên nó chấp nhận đúng ca mà luật này tồn tại để từ chối — và scripts/
 * verify-technical-rules.ts bắt được bằng phép kiểm độ phủ nhánh: nhánh
 * "reject — chữ số vượt mức đã in" không có vector nào chạm tới, vì không ca
 * nào còn reject được nữa.
 */
function renderings(value: number): string[] {
  const out = new Set<string>();
  const withSeparators = (s: string): string => {
    const [int, frac] = s.split(".");
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
  };
  const offer = (s: string) => {
    out.add(s);
    out.add(withSeparators(s));
  };

  offer(String(value));
  // Chỉ những độ chính xác KHÔNG làm mất giá trị: Number(toFixed(d)) === value.
  for (let d = 0; d <= 6; d++) {
    const padded = value.toFixed(d);
    if (Number(padded) === value) offer(padded);
  }
  return [...out];
}

/**
 * Con số phải xuất hiện NHƯ MỘT CON SỐ, không phải như một mảnh của con số khác.
 *
 * "46" nằm trong "46.0%" và trong "460 households". Không có ranh giới thì một
 * giá trị thô lọt qua chỉ vì phần nguyên của nó tình cờ là đầu một số khác —
 * và nó lọt theo hướng dễ dãi, tức là im lặng.
 */
function appearsAsNumber(text: string, candidate: string): boolean {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.,])${escaped}(?!\\d)(?!\\.\\d)`).test(text);
}

/**
 * LUẬT 1 — jsonld-value-displayed-only.
 *
 * Con số công bố cho máy phải là con số đã in cho người. Mở rộng đúng chính
 * sách rounding.policy = "displayed-only" sang JSON-LD.
 *
 * Chú ý chiều của phép kiểm: nó KHÔNG hỏi "giá trị này có đúng không" — giá
 * trị thô thường là giá trị đúng nhất tồn tại. Nó hỏi "trang có chịu trách
 * nhiệm về độ chính xác này không". Một ước lượng ACS 5 năm có sai số ±1-2
 * điểm phần trăm mà khai 46.02954943221133% là khai 16 chữ số có nghĩa cho
 * một con số không có nổi 3 — và khai ở đúng chỗ máy tin.
 */
export function checkDisplayedOnlyValue(mv: MeasuredValue, visibleText: string): RuleVerdict {
  const value = typeof mv.value === "number" ? mv.value : Number(mv.value);
  if (!Number.isFinite(value)) {
    return { passed: false, reason: `value "${mv.value}" không phải số` };
  }
  // SỐ NGUYÊN nằm ngoài phạm vi luật, và đây là chỗ bản đầu tiên quá rộng.
  //
  // Trang in "$2.25 billion" cho 2249409000 — chính sách rounding.policy của HQ
  // cho phép "một dạng đổi thang của giá trị đo (nghìn/triệu/tỷ)". Bắt số
  // nguyên phải xuất hiện nguyên dạng sẽ buộc JSON-LD công bố 2.25e9 thay cho
  // con số IRS thật, tức là luật đòi dữ liệu máy KÉM chính xác hơn. Đổi thang
  // không bịa ra chữ số nào; chỉ phần thập phân mới bịa được.
  if (Number.isInteger(value)) {
    return { passed: true, reason: `${value} là số nguyên — không có chữ số thập phân nào để bịa` };
  }

  const found = renderings(value).find((r) => appearsAsNumber(visibleText, r));
  if (found) return { passed: true, reason: `trang có in "${found}"` };
  return {
    passed: false,
    reason: `không cách in nào của ${value} xuất hiện trên trang — chữ số vượt quá mức trang chịu trách nhiệm`,
  };
}

/**
 * Từ vựng phép tính bắt buộc.
 *
 * Cố định thành danh sách chứ không nhận "bất kỳ động từ nào", vì một luật
 * nhận bất kỳ chuỗi nào có chữ thì không từ chối được gì.
 */
const AGGREGATION_VERBS = ["sum", "total", "median", "mean", "average", "count", "min", "max", "range", "spread"];
const SCOPE_NOUNS = "ZIP codes?|zip codes?|counties|county|states?|metros?|CBSAs?|markets?";
const RESOLUTION_MARKER = /\((zip|county|state|metro|cbsa)[- ]level\)/i;

/**
 * LUẬT 2 — jsonld-aggregate-declares-scope.
 *
 * Nửa JSON-LD của luật `aggregate-must-declare-scope` đang khai báo ở HQ. Luật
 * đó yêu cầu một con số gộp phải in kèm phép tính, SỐ LƯỢNG geography, danh từ
 * phạm vi và nguồn — "và phải vào cả measurementTechnique trong JSON-LD".
 * Nửa văn bản chỉ build của site mới thấy. Nửa JSON-LD thì HQ đọc được, nên
 * đây là chỗ luật đó có thể có bằng chứng CHẠY thay vì chỉ được khai báo.
 *
 * Hai hình dạng hợp lệ, không có hình thứ ba:
 *   thô:  "<nguồn> (<zip|county|state>-level)"
 *   gộp:  "<phép tính> of <nguồn> across <N> <danh từ phạm vi>"
 *
 * Vì sao SỐ LƯỢNG là bắt buộc chứ không phải trang trí: nó là thứ duy nhất cho
 * người đọc kiểm lại phép cộng. Và vì sao phạm vi là bắt buộc: cộng một chỉ số
 * cấp COUNTY theo từng ZIP nhân nó lên tới 13.07 lần — đo được trên
 * irs_migration_net_households, và con số đó đang nằm trên một trang trụ.
 */
export function checkAggregateTechnique(mv: MeasuredValue): RuleVerdict {
  const technique = (mv.measurementTechnique ?? "").trim();
  if (technique === "") {
    return { passed: false, reason: "không có measurementTechnique — con số cấp hạt và con số cấp zip trông y hệt nhau" };
  }

  const verb = AGGREGATION_VERBS.find((v) => new RegExp(`^${v}\\b`, "i").test(technique));
  if (verb) {
    const across = new RegExp(`across\\s+(\\d[\\d,]*)\\s+(${SCOPE_NOUNS})`, "i").exec(technique);
    if (!across) {
      return {
        passed: false,
        reason: `khai phép tính "${verb}" nhưng không nói gộp qua BAO NHIÊU địa bàn và ở cấp nào — không ai kiểm lại được phép cộng`,
      };
    }
    if (!/\bof\b/i.test(technique)) {
      return { passed: false, reason: `khai phép tính "${verb}" nhưng không nói gộp từ nguồn nào` };
    }
    return { passed: true, reason: `gộp khai đủ: ${verb} · ${across[1]} ${across[2]}` };
  }

  const marker = RESOLUTION_MARKER.exec(technique);
  if (marker) return { passed: true, reason: `số thô, khai cấp đo: ${marker[0]}` };

  return {
    passed: false,
    reason: `"${technique}" không khớp hình dạng nào: thiếu cả cấp đo "(zip-level)" lẫn phép tính "<x> of <nguồn> across <N> <phạm vi>"`,
  };
}

// --------------------------------------------------------------- vectors

export interface TechnicalVector {
  rule: "jsonld-value-displayed-only" | "jsonld-aggregate-declares-scope";
  /** Verdict được ĐO bằng cách chạy vị ngữ ở trên, không phải viết tay ở đây. */
  expect?: "accept" | "reject";
  value: MeasuredValue;
  /** Văn bản nhìn thấy được của trang giả lập, cho luật 1. */
  visibleText?: string;
  why: string;
}

/**
 * Vector hai chiều, dựng cố định.
 *
 * Cố định và tổng hợp có chủ ý: vector lấy từ site đang chạy sẽ đổi mỗi lần
 * site publish, và một bộ conformance có kết quả kỳ vọng tự trôi là bộ không
 * ai hành động được. Cùng lý do VECTOR_FACTS trong registry.ts là tổng hợp.
 *
 * Mỗi ca reject dưới đây tương ứng một thứ ĐANG XẢY RA THẬT trên
 * atmovingservices.com ngày 2026-09-10, không phải một lỗi tưởng tượng.
 */
export const TECHNICAL_VECTORS: TechnicalVector[] = [
  {
    rule: "jsonld-value-displayed-only",
    value: { name: "Median home value", value: 372100, unitText: "USD" },
    visibleText: "Median home value $372,100 for this ZIP code.",
    why: "Trang in có dấu phân cách nghìn, JSON-LD ghi số trần. Cùng một con số — luật phải cho qua, nếu không nó sẽ kêu ở mọi trang rồi bị tắt.",
  },
  {
    rule: "jsonld-value-displayed-only",
    value: { name: "Homeownership rate", value: 46.9, unitText: "%" },
    visibleText: "46.9% of homes are owner-occupied.",
    why: "Có phần thập phân, và đúng mức trang in. Ca accept của nhánh so-khớp — không có nó thì không phân biệt được luật này với một luật từ chối mọi số thập phân.",
  },
  {
    rule: "jsonld-value-displayed-only",
    value: { name: "Income arriving with inbound households", value: 2249409000, unitText: "USD/yr" },
    visibleText: "Income arriving with inbound households $2.25 billion, county level.",
    why: "ĐANG XẢY RA và ĐÚNG: /moving-services/ca/sacramento-95823. Trang in dạng đổi thang đã làm tròn, JSON-LD giữ con số IRS nguyên vẹn. Luật phải cho qua — bắt nó công bố 2.25e9 là đòi dữ liệu máy kém chính xác hơn dữ liệu thật.",
  },
  {
    rule: "jsonld-value-displayed-only",
    value: { name: "Homeownership rate", value: 46.02954943221133, unitText: "%" },
    visibleText: "46.0% of homes are owner-occupied.",
    why: "ĐANG XẢY RA: /moving-services/ca/sacramento-95823 công bố đúng chuỗi này trong khi trang chỉ in 46.0%.",
  },
  {
    rule: "jsonld-value-displayed-only",
    value: { name: "Residents who moved in the past year", value: 15.77459714851814, unitText: "%" },
    visibleText: "15.8% of residents moved in the past year.",
    why: "ĐANG XẢY RA: /moving-services/ct/stamford-06902. 14 chữ số thập phân cho một ước lượng ACS có sai số ±1-2 điểm phần trăm.",
  },
  {
    rule: "jsonld-aggregate-declares-scope",
    value: { name: "moved within the same county", value: 1271931, measurementTechnique: "sum of Census ACS5 (geographic mobility) across 256 ZIP codes" },
    why: "ĐANG XẢY RA và ĐÚNG: /local-moving khai đủ phép tính, nguồn, số lượng và danh từ phạm vi. Ca accept này là thứ chứng minh luật không phải lúc nào cũng từ chối.",
  },
  {
    rule: "jsonld-aggregate-declares-scope",
    value: { name: "Median home value", value: 515000, measurementTechnique: "Census ACS5 (housing & income) (zip-level)" },
    why: "Số thô khai đúng cấp đo. Không phải số gộp nên không cần 'across N'.",
  },
  {
    rule: "jsonld-aggregate-declares-scope",
    value: { name: "moved within the same county", value: 1271931, measurementTechnique: "sum of Census ACS5 (geographic mobility)" },
    why: "Có phép tính, KHÔNG có số lượng địa bàn. Đây chính là hình dạng của lỗi nhân 13.07 lần: cộng một chỉ số cấp hạt theo từng zip trông y hệt cộng đúng, cho tới khi đếm được đã cộng qua bao nhiêu địa bàn.",
  },
  {
    rule: "jsonld-aggregate-declares-scope",
    value: { name: "Net households", value: -11517, measurementTechnique: "IRS SOI County Migration" },
    why: "Không phép tính, không cấp đo. Một con số cấp hạt in trên trang zip mà không có gì trong JSON-LD nói nó là cấp hạt.",
  },
  {
    rule: "jsonld-aggregate-declares-scope",
    value: { name: "Households in", value: 66853, measurementTechnique: "" },
    why: "Rỗng. Nhánh im lặng của luật — phải nổ, nếu không thì một site bỏ trống trường này sẽ pass mà không ai biết.",
  },
  {
    rule: "jsonld-aggregate-declares-scope",
    value: { name: "moved within the same county", value: 1271931, measurementTechnique: "sum Census ACS5 across 256 ZIP codes" },
    why: "Có phép tính VÀ có số lượng, thiếu chữ 'of' nối sang nguồn. Ca này tồn tại vì nhánh 'thiếu nguồn' nằm SAU nhánh 'thiếu số lượng' — không có nó thì xoá nhánh đó đi bộ vector vẫn xanh.",
  },
  {
    rule: "jsonld-value-displayed-only",
    value: { name: "Median home value", value: "$372,100", unitText: "USD" },
    visibleText: "Median home value $372,100 for this ZIP code.",
    why: "value là CHUỖI đã định dạng, không phải số. Trang có in đúng chuỗi đó, nên nếu luật chỉ so chuỗi thì ca này pass — mà schema.org yêu cầu PropertyValue.value là số để máy dùng được. Nhánh 'không phải số' phải nổ ở đây.",
  },
];

/** Chạy vị ngữ thật để lấy verdict. Không hàm nào ở đây được phép GHI verdict. */
export function measureVectors(): (TechnicalVector & { expect: "accept" | "reject"; measuredReason: string })[] {
  return TECHNICAL_VECTORS.map((v) => {
    const verdict =
      v.rule === "jsonld-value-displayed-only"
        ? checkDisplayedOnlyValue(v.value, v.visibleText ?? "")
        : checkAggregateTechnique(v.value);
    return { ...v, expect: verdict.passed ? "accept" : "reject", measuredReason: verdict.reason };
  });
}
