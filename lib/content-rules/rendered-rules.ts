// Hai luật nội dung chạy trên HTML ĐÃ RENDER.
//
// Ở lib/ chứ không ở scripts/ vì scripts là nơi TIÊU THỤ hợp đồng, không phải
// nơi định nghĩa nó — registry.ts import xuôi chiều xuống đây, và chỉ có đúng
// một bản cài đặt cho mỗi luật.
//
// VÌ SAO CẦN LUẬT CHẠY SAU KHI RENDER
//
// lib/ai/generate.ts mang luật trong prompt, lib/ai/validate.ts chạy trên chuỗi
// model vừa trả về, scripts/scan-generated-copy.ts quét generation đã lưu trong
// DB. Cả ba soi VĂN DO MODEL SINH. Nhưng phần lớn một trang publish ra là
// TEMPLATE do code site viết, và template không đi qua model, nên không đi qua
// bất cứ chỗ nào biết tới luật.
//
// Đo trên atmovingservices.com 2026-09-10, crawl toàn bộ 192 URL: 368 câu vi
// phạm no-supply-side-bridge, thuộc 9 template, không câu nào từng đi qua
// validateGeneratedText().

// ---------------------------------------------------------------------------
// Luật mới: supply-side bridge trong văn ĐÃ RENDER
// ---------------------------------------------------------------------------

/**
 * Ba mảnh, và mảnh thứ ba là mảnh quan trọng nhất.
 *
 * ANTECEDENT — câu phải treo hệ quả lên một ĐẠI LƯỢNG ĐO. Không có mảnh này,
 * "the disagreement is the signal, and working out why is this end's job" trên
 * trang /data bị bắt: một câu về quy trình nội bộ, không hề nói về thị trường.
 * Đó là một câu, trên 368 — nhưng một cảnh báo sai là thứ dạy người đọc lướt
 * qua, và lướt qua là cách cái thật bị bỏ sót.
 *
 * SUPPLY — hệ quả phải KHẲNG ĐỊNH về phía cung. Cố tình không nhận `work` hay
 * `crew` trần: "moves involve rented apartments" nói về người thuê nhà, không
 * nói về bên cung, và rule 8 cho phép nó như một phép trừ số học.
 *
 * ADVICE — lối thoát mà rule 8 nêu đích danh. "Homes date from 1966, so ask how
 * the crew protects narrow stairways" là lời khuyên gắn vào một dữ kiện, không
 * khẳng định gì về thị trường. Quét TOÀN CÂU chứ không chỉ phần sau connector:
 * "When you call for quotes, say plainly which distance applies — ... so the
 * estimate should match the job" mở đầu bằng lời khuyên và kết thúc bằng chữ
 * "job", và cắt câu ở connector sẽ bắt nhầm đúng nó.
 *
 * Đây KHÔNG phải mở rộng của migration_bridge trong copy-patterns.ts. Cái kia
 * cố ý chỉ soi số DI CƯ, đúng phạm vi rule 9 cấm tuyệt đối, và đã bị thu hẹp
 * một lần sau khi nó báo nhầm một câu rule 8 cho phép. Luật này soi hình dạng
 * "đại lượng đo → khẳng định về công việc/bên cung" trên mọi loại figure, và
 * chỉ chạy trên văn đã render — nơi cái kia không bao giờ nhìn tới.
 */
const ANTECEDENT =
  /(?:\d|\b(?:most|majority|more\s+\w+\s+than|close\s+to\s+even|typical|median|rate|balance|arrivals?|departures?|moves?|migration)\b)/i;

const CONNECTOR =
  /(?:\b(?:so|therefore|meaning|that\s+means)\b|\bwhich\s+(?:is|means|in\s+practice\s+means)\b|—)/i;

const SUPPLY_ASSERTION = new RegExp(
  [
    String.raw`\b(?:jobs?|workload|logistics|bookings?|capacity)\b`,
    String.raw`\bdemand\s+(?:splits?|is|runs?|means)\b`,
    String.raw`\b(?:hourly|flat)\s+rates?\b`,
    String.raw`\bcrews?\s+(?:is|are|work\w*|handles?)\b`,
    String.raw`\b(?:movers?|companies|providers?|contractors?)\s+(?:here\s+|locally\s+)?(?:handle|are|tend|book|charge|do)\b`,
    String.raw`\b(?:inbound|outbound)\s+work\b`,
  ].join("|"),
  "i"
);

const READER_ADVICE =
  /\b(?:ask|asking|confirm|check|point\s+out|mention|mentioning|say|tell|walk|compare|call|calling|choose|worth\s+\w+ing|if\s+that\s+applies|when\s+you|your\s+move|leave\s+the\s+number)\b/i;

/** Toàn bộ luật, ở dạng một vị ngữ máy chạy được trên MỘT câu. */
export function isSupplySideBridge(sentence: string): boolean {
  if (READER_ADVICE.test(sentence)) return false;

  const conn = CONNECTOR.exec(sentence);
  if (!conn) return false;

  const antecedent = sentence.slice(0, conn.index);
  if (!ANTECEDENT.test(antecedent)) return false;

  const consequent = sentence.slice(conn.index, conn.index + 200);
  return SUPPLY_ASSERTION.test(consequent);
}

// ---------------------------------------------------------------------------
// Luật hai: một con số dẫn xuất khai SAI số lượng geography góp vào nó
// ---------------------------------------------------------------------------

/**
 * Đây là `aggregate-must-declare-scope` nhìn từ một phía chưa ai nhìn.
 *
 * Luật đó đòi một con số gộp qua nhiều địa bàn phải in kèm SỐ LƯỢNG geography
 * góp vào. Trên site đo được, phần "gộp" không bị vi phạm chút nào — trang cụm
 * cố ý KHÔNG cộng số county, mà tách riêng từng county ("Migration, county by
 * county", "Harris County — 7 of these ZIP codes"), và ghi thẳng "No substitute
 * or county average is shown in its place". Cộng một metric COUNTY theo từng ZIP
 * nhân lên tới 13.07x, và site này không làm phép cộng đó.
 *
 * Nhưng trang cụm có một loại số dẫn xuất KHÁC: tỷ số max/min qua các ZIP,
 * in ra là "a 1.77 × spread across one county". Tỷ số ấy đúng. Cái sai là mệnh
 * đề phạm vi đi kèm — trang Houston tự khai ngay đoạn mở đầu rằng nó trải BA
 * county, rồi năm dòng dưới nói con số trải "one county".
 *
 * Vì sao đây là luật chứ không phải lỗi chính tả: mệnh đề phạm vi là thứ DUY
 * NHẤT cho người đọc kiểm được con số. "1.77× across one county" mời người đọc
 * hiểu rằng chênh lệch ấy tồn tại bên trong một thị trường; "across three
 * counties" nói một điều khác hẳn — rằng nó tồn tại giữa ba thị trường bị gộp
 * vào một trang. Cùng một con số, hai kết luận trái ngược, và phần quyết định
 * kết luận là phần bị in sai.
 *
 * HQ kiểm được từ xa mà không cần dữ liệu gì bên ngoài: **trang tự mâu thuẫn với
 * chính nó**. Nó khai số county ở một chỗ và phủ nhận ở chỗ khác. Không phép đo
 * nào ngoài trang tham gia vào kết luận này.
 */
const DECLARED_COUNTIES = /\bThey span (\d+) count(?:y|ies)\b/i;
const DERIVED_SCOPE_CLAIM = /×\s*spread\s+across\s+(one|two|three|four|\d+)\s+count(?:y|ies)/gi;

const WORD_TO_NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

export interface ScopeMismatch {
  declared: number;
  claimed: number;
  phrase: string;
}

/**
 * Nhận VĂN BẢN của cả trang, không phải từng câu: hai vế của mâu thuẫn nằm ở
 * hai đoạn cách nhau, nên một luật chạy trên từng câu không thể thấy nó. Đây là
 * lý do luật này không nối vào `isSupplySideBridge()` mà đứng riêng.
 */
export function findScopeCountMismatches(pageText: string): ScopeMismatch[] {
  const declaredMatch = DECLARED_COUNTIES.exec(pageText);
  // Không tự khai thì không có gì để mâu thuẫn. Một trang ZIP đơn lẻ rơi vào
  // đây, và im lặng là kết luận đúng cho nó — không phải "sạch", mà "luật này
  // không có bề mặt trên trang đó".
  if (!declaredMatch) return [];
  const declared = Number(declaredMatch[1]);

  const out: ScopeMismatch[] = [];
  DERIVED_SCOPE_CLAIM.lastIndex = 0;
  for (const m of pageText.matchAll(DERIVED_SCOPE_CLAIM)) {
    const claimed = WORD_TO_NUMBER[m[1].toLowerCase()] ?? Number(m[1]);
    if (claimed !== declared) out.push({ declared, claimed, phrase: m[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vector — verdict ĐO bằng cách chạy hàm trên, không phải khai bằng tay
// ---------------------------------------------------------------------------

/**
 * Mọi câu ở đây là NGUYÊN VĂN từ atmovingservices.com, crawl 2026-09-10. Không
 * câu nào được viết ra để test.
 *
 * `expect` là điều luật PHẢI kết luận. Chương trình chạy vector và so — nó
 * không ghi lại kết luận của chính nó rồi gọi đó là kết quả.
 */
export const SUPPLY_BRIDGE_VECTORS: { expect: "reject" | "accept"; text: string; why: string }[] = [
  {
    expect: "reject",
    text: "Most moves into Duluth, GA started nearby, which is local-crew work: hourly rates, same-day jobs, and no long-haul logistics.",
    why: "97 trang. Từ 'phần lớn cuộc chuyển nhà đến từ gần' suy ra loại công việc VÀ cách tính tiền của bên cung. Không nguồn nào trong dataset đo cả hai.",
  },
  {
    expect: "reject",
    text: "The balance is -3,389 households a year — more households leave than arrive, which in practice means more long-distance and out-of-state jobs than a purely local market would see.",
    why: "57 trang. 'which in practice means' + khẳng định so sánh khối lượng việc với một thị trường giả định.",
  },
  {
    expect: "reject",
    text: "The balance is 687 households a year — more people move into this area than out of it, so local movers here handle a steady flow of inbound jobs alongside local ones.",
    why: "44 trang. Nói thẳng công ty ở đây làm gì. Đây là câu duy nhất trong bốn câu mà supply_side_claim của copy-patterns.ts cũng bắt được.",
  },
  {
    expect: "reject",
    text: "Arrivals and departures are close to even at 647 households a year, so demand splits between inbound and outbound work.",
    why: "25 trang. 'demand splits' — một khẳng định về cầu của thị trường lao động, suy từ số hộ khai thuế.",
  },
  {
    expect: "reject",
    text: "The typical home in 78666 dates to 1997, which is what decides whether a crew is working around stairs, narrow stairwells and no elevator, or a modern layout with a driveway to park in.",
    why: "127 trang — nhiều nhất. Rule 8 nêu ĐÍCH DANH biến thể hợp lệ của câu này: 'Homes date from 1966, so ASK how the crew protects narrow stairways'. Bỏ chữ 'ask' đi thì lời khuyên thành khẳng định về điều kiện làm việc, và năm xây nhà không quyết định được điều đó.",
  },
  {
    expect: "accept",
    text: "The typical home here was built around 1940, so when you walk the job with an estimator, point out narrow staircases, tight doorways and street parking constraints and ask how the crew will protect them.",
    why: "Lời khuyên cho người đọc gắn vào một dữ kiện — rule 8 cho phép. Cùng con số, cùng chữ 'crew', khác ở chỗ nó không khẳng định gì về thị trường.",
  },
  {
    expect: "accept",
    text: "The homeownership rate here is 38.4%, so the majority of households are renting — worth mentioning when you call for quotes, since apartment and student-housing moves often involve stair carries, elevator reservations and longer walks.",
    why: "Phép trừ số học rồi tới lời khuyên. Rule 8 nêu đích danh hình dạng này là hợp lệ.",
  },
  {
    expect: "accept",
    text: "When you call for quotes, say plainly which of those distances applies to you — a crosstown move within the county and an out-of-state haul are priced and scheduled in different ways, so the estimate should match the job.",
    why: "Kết thúc bằng chữ 'job' ngay sau 'so'. Cắt câu ở connector rồi mới xét sẽ bắt nhầm đúng câu này — nên phần miễn trừ phải quét TOÀN CÂU.",
  },
  {
    expect: "accept",
    text: "Rather than generate a plausible-looking range, these pages publish the local conditions a quote is actually built from — housing age, stairs versus lift access, owner-occupied versus rental — and leave the number to the companies that can actually see your belongings.",
    why: "Câu TỪ CHỐI nêu giá, tức là luật no-price-claims đang chạy đúng. Một bộ quét bắt cả câu này sẽ dạy người đọc bỏ qua nó.",
  },
  {
    expect: "accept",
    text: "No explanation needed — the disagreement is the signal, and working out why is this end's job.",
    why: "Câu về quy trình nội bộ trên /data, không nói gì về thị trường. Có dấu gạch dài và chữ 'job', và CHỈ nhánh ANTECEDENT cứu nó — không nhánh nào khác thấy nó khác gì một khẳng định về công việc.",
  },
];

/**
 * Vector cho luật hai. Nhận VĂN BẢN TRANG, nên mỗi ca là một đoạn rút gọn giữ
 * đúng hai vế của mâu thuẫn — câu tự khai số county, và câu khai phạm vi của
 * con số dẫn xuất.
 *
 * Ba ca đầu là NGUYÊN VĂN từ site. Hai ca cuối đánh dấu DỰNG, và nói rõ vì sao
 * phải dựng: trên site hiện tại chúng không tồn tại, nhưng nếu không có chúng
 * thì hai nhánh thu hẹp của luật không ca nào ép chạy tới.
 */
export const SCOPE_COUNT_VECTORS: { expect: "reject" | "accept"; label: string; text: string; why: string }[] = [
  {
    expect: "reject",
    label: "tx/houston (nguyên văn)",
    text:
      "10 ZIP codes in Houston have federal housing data collected for them. They span 3 counties — Harris County, Fort Bend County and Montgomery County. " +
      "Median home value runs from $217,400 in 77036 to $384,400 in 77433 — a 1.77 × spread across one county.",
    why: "Trang tự khai 3 county ở đoạn mở đầu, rồi nói con số dẫn xuất trải 'one county'. 5 dòng như vậy trên trang này.",
  },
  {
    expect: "reject",
    label: "va/virginia-beach (nguyên văn)",
    text:
      "They span 2 counties — Norfolk city and Virginia Beach city, all within the Virginia Beach-Chesapeake-Norfolk, VA-NC metro area. " +
      "Homeownership rate runs from 41.1% in 23464 to 55.9% in 23503 — a 1.36 × spread across one county.",
    why: "Cùng lỗi với 2 county. Đo được trên 4 trang, 18 câu.",
  },
  {
    expect: "accept",
    label: "ny/brooklyn (nguyên văn)",
    text:
      "23 ZIP codes in Brooklyn have federal housing data collected for them. They span 1 county — Kings County. " +
      "Median home value runs from $549,400 in 11212 to $1,674,700 in 11215 — a 3.05 × spread across one county.",
    why: "Cụm một county nói 'one county' — ĐÚNG. Ca này là thứ chặn luật thoái hoá thành 'mọi câu spread đều sai'.",
  },
  {
    expect: "accept",
    label: "DỰNG — cụm đa county khai đúng",
    text:
      "They span 3 counties — Harris County, Fort Bend County and Montgomery County. " +
      "Median home value runs from $217,400 to $384,400 — a 1.77 × spread across three counties.",
    why:
      "Hình dạng ĐÚNG mà site chưa có trang nào đạt được, nên phải dựng. Không có ca này thì không gì chứng minh luật chấp nhận một bản sửa — nó chỉ chứng minh luật biết từ chối.",
  },
  {
    expect: "accept",
    label: "DỰNG — không tự khai số county",
    text: "Median home value runs from $217,400 to $384,400 — a 1.77 × spread across one county.",
    why:
      "Không có câu 'They span N counties' thì không có gì để mâu thuẫn, và luật phải im. Ép nhánh `if (!declaredMatch) return []` chạy tới. Trên site không có trang thật nào ở hình dạng này (đã kiểm trang state và trang ZIP: cả hai đều không in cụm spread), nên ca này dựng — và đó chính là lý do nó cần thiết.",
  },
];

interface VectorResult {
  expect: string;
  got: string;
  ok: boolean;
  text: string;
  why: string;
}

export function runScopeVectors(): (VectorResult & { label: string })[] {
  return SCOPE_COUNT_VECTORS.map((v) => {
    const got = findScopeCountMismatches(v.text).length > 0 ? "reject" : "accept";
    return { expect: v.expect, got, ok: got === v.expect, text: v.text, why: v.why, label: v.label };
  });
}

export function runVectors(): VectorResult[] {
  return SUPPLY_BRIDGE_VECTORS.map((v) => {
    const got = isSupplySideBridge(v.text) ? "reject" : "accept";
    return { expect: v.expect, got, ok: got === v.expect, text: v.text, why: v.why };
  });
}

/**
 * Tự kiểm, và một điều kiện mà "9/9 vector xanh" KHÔNG chứng minh được.
 *
 * HQ trả bằng máu hôm nay: có ca test cho một nhánh, xoá nhánh đi mà cả bộ vẫn
 * xanh. Ở đây nhánh dễ chết lặng nhất là READER_ADVICE — nếu nó biến mất, luật
 * chỉ đơn giản bắt nhiều hơn, và mọi vector `reject` vẫn xanh y nguyên.
 *
 * Nên bộ vector phải chứa ít nhất một ca mà CHỈ nhánh đó cứu. Kiểm bằng cách
 * chạy lại vector với nhánh bị vô hiệu và đòi hỏi có ca đổi kết quả — tức là ép
 * nhánh nổ, chứ không đọc code rồi tin là nó có chạy.
 */

// ---------------------------------------------------------------------------
// Ép nhánh im nổ — bằng chứng mà "cả bộ vector xanh" KHÔNG cung cấp
// ---------------------------------------------------------------------------

/**
 * Một ca test tồn tại KHÔNG chứng minh nhánh được chạy tới. Bằng chứng cho điều
 * đó, trong chính dự án này: HQ có ca cho một nhánh, xoá nhánh đi mà cả bộ test
 * vẫn xanh.
 *
 * Nên mỗi nhánh THU HẸP phải bị vô hiệu một lần, và phải có vector đổi kết quả.
 * Nhánh nào không làm vector nào đổi là nhánh có thể xoá mà không ai biết.
 *
 * Chỉ đột biến nhánh THU HẸP. Vô hiệu một nhánh MỞ RỘNG (SUPPLY_ASSERTION) thì
 * không còn gì bị bắt, nên mọi vector reject đều đổi và phép thử luôn xanh mà
 * không chứng minh điều gì — một phép thử luôn đúng là phép thử không hỏi gì.
 *
 * Đặt ở đây chứ không ở scripts/ để registry cũng chạy được bằng chứng này, chứ
 * không phải đọc mô tả rằng nó từng chạy.
 */
export interface BranchProof {
  branch: string;
  vectorsChanged: number;
}

export function proveSupplyBridgeBranches(): BranchProof[] {
  const baseline = runVectors();
  const proofs: BranchProof[] = [];
  for (const [branch, re, stub] of [
    ["ANTECEDENT", ANTECEDENT, () => true],
    ["READER_ADVICE", READER_ADVICE, () => false],
  ] as const) {
    const saved = re.test.bind(re);
    (re as unknown as { test: (s: string) => boolean }).test = stub;
    const changed = runVectors().filter((r, i) => r.got !== baseline[i].got).length;
    (re as unknown as { test: (s: string) => boolean }).test = saved;
    proofs.push({ branch, vectorsChanged: changed });
  }
  return proofs;
}

export function proveScopeBranches(): BranchProof[] {
  const baseline = runScopeVectors();

  // Nhánh "không tự khai số county thì im": ép câu tự khai LUÔN khớp với một
  // con số khác 1, ca không-tự-khai phải đổi sang reject.
  const savedExec = DECLARED_COUNTIES.exec.bind(DECLARED_COUNTIES);
  (DECLARED_COUNTIES as unknown as { exec: (s: string) => RegExpExecArray | null }).exec = () =>
    ["They span 2 counties", "2"] as unknown as RegExpExecArray;
  const a = runScopeVectors().filter((r, i) => r.got !== baseline[i].got).length;
  (DECLARED_COUNTIES as unknown as { exec: (s: string) => RegExpExecArray | null }).exec = savedExec;

  // Nhánh so sánh claimed vs declared: đọc lệch "one", ca khai ĐÚNG phải đổi.
  const savedOne = WORD_TO_NUMBER.one;
  WORD_TO_NUMBER.one = 99;
  const b = runScopeVectors().filter((r, i) => r.got !== baseline[i].got).length;
  WORD_TO_NUMBER.one = savedOne;

  return [
    { branch: "im-khi-không-tự-khai", vectorsChanged: a },
    { branch: "so-sánh-số-lượng", vectorsChanged: b },
  ];
}
