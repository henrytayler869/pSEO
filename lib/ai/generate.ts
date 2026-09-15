import { prisma } from "@/lib/db/prisma";
import { buildFactSet, type FactSet, type Fact } from "./facts";
import { judgeDistinctness, avoidBlock, MAX_SHARED_RUN_WORDS } from "./distinctness";
import { validateGeneratedText, type ValidationResult } from "./validate";
import { generateWithClaude, IncompleteGenerationError } from "./anthropic";
import crypto from "node:crypto";

const MAX_ATTEMPTS = 2; // one retry: a second failure is a prompt problem, not luck

/**
 * What each trade actually does, and which neighbouring trades it does not.
 *
 * Needed because one shared prompt across 13 verticals produced copy that
 * fit none of them. Asked to write for a "service provider" with no idea
 * which service, the model reached for whatever the housing data suggested
 * — and housing data suggests maintenance. Moving-services pages came back
 * discussing "plumbing, wiring, and heating systems", "roofing", "warranty
 * terms" and "routine service": every phrase defensible for a contractor,
 * none of it relevant to hiring movers. 16 of 35 generations did this.
 *
 * The off-limits list is the load-bearing half. Naming the trade alone
 * doesn't stop the drift, because the drift comes from the data: median
 * year built genuinely does imply something about a building's systems —
 * it just isn't the mover's problem.
 */
const VERTICAL_BRIEFS: Record<string, { does: string; offLimits: string }> = {
  "moving-services": {
    does: "helping households pack, load, transport and unload their belongings when they move home",
    offLimits:
      "building maintenance or repair of any kind — plumbing, wiring, electrical, HVAC, heating, roofing, renovation — and anything about warranties, routine servicing or maintenance schedules. Movers do not repair buildings. Do not discuss the condition of a home's systems.",
  },
  "hvac-repair": {
    does: "repairing and servicing home heating, ventilation and air-conditioning systems",
    offLimits: "moving, roofing, plumbing unrelated to HVAC, and general remodelling",
  },
  "roofing-replacement": {
    does: "replacing and repairing residential roofs",
    offLimits: "interior work, moving, HVAC and plumbing",
  },
  "water-damage-restoration": {
    does: "drying out, cleaning and restoring homes after water intrusion",
    offLimits: "routine remodelling, moving, and roof replacement unrelated to the water event",
  },
  "garage-door-repair": {
    does: "repairing and replacing residential garage doors and their openers",
    offLimits: "any other part of the house — roofing, HVAC, plumbing, moving",
  },
  "pest-control": {
    does: "identifying and treating insect and rodent infestations in homes",
    offLimits: "structural repair, moving, and general home maintenance",
  },
  "solar-installation": {
    does: "designing and installing residential rooftop solar systems",
    offLimits: "roof replacement itself, moving, and unrelated electrical work",
  },
  /**
   * ⚠️ Ngành này có một dạng lạc-nghề mà cơ chế suy diễn KHÔNG bắt được.
   *
   * scan-generated-copy.ts suy ra "lạc nghề" bằng từ vựng của những nghề
   * KHÁC — hợp lý cho sáu ngành trên, nơi lỗi là viết về mái nhà trên trang
   * chuyển nhà. Với nghề luật, dạng nguy hiểm nhất lại là từ vựng của CHÍNH
   * nghề này: mức bồi thường, tỷ lệ thắng kiện, thời gian giải quyết, giá
   * trị vụ việc.
   *
   * Ba luật hiện có đều trượt nó, mỗi luật vì một lý do khác nhau:
   *   no-supply-side-bridge  chỉ bắt khi BẮC CẦU từ một con số
   *   no-price-claims        chặn giá DỊCH VỤ; bồi thường không phải giá
   *   stay-in-trade          chặn nói như ngành KHÁC
   *
   * Nên `offLimits` ở đây phải liệt kê tường minh, không dựa vào suy diễn.
   * Nó là bản sinh đôi ở tầng prompt của luật `no-outcome-claims` trong
   * registry — hai chỗ, cùng một tập cấm, cố ý viết cùng lúc để không chỗ
   * nào lỏng hơn chỗ kia.
   *
   * Và với nghề luật, một câu như vậy không chỉ là nội dung yếu: nó là
   * quảng cáo sai sự thật.
   */
  "auto-accident-attorney": {
    does: "representing people injured in motor-vehicle collisions in claims against insurers and other drivers",
    offLimits:
      "ANY claim about what a case is worth, how much money anyone recovers, typical or average settlements, verdict amounts, success or win rates, how long a case takes to resolve, or the chance of any outcome — no dataset here measures any of that, and stating it is false advertising for a law practice. Also off limits: legal advice of any kind, what a reader should do about their own claim, deadlines or filing requirements, fee arrangements including contingency percentages, and anything about how busy, experienced or successful any firm is. You may state the measured figures and address the reader about what to ask or confirm; you may not tell them what will happen. " +
      "SCOPE OF THE CRASH FIGURES, and this is the one thing readers cannot check for themselves: the crash counts here come from FARS, which records ONLY crashes in which someone died. A figure labelled \"fatal traffic crashes in a year\" must never be described as accidents, collisions, crashes, wrecks or incidents without the word fatal attached — every one of those words names a far larger set, and dropping \"fatal\" silently inflates the number by orders of magnitude. The two crash figures are also NOT interchangeable: one counts CRASHES in which someone died, the other counts PEOPLE killed, and a single crash can kill several people. Never restate one as the other and never use one label for both.",
  },
};

const SYSTEM_PROMPT = `You write short, factual copy for local service pages.

You will be given a list of MEASURED figures. These are the only facts you may state.

Absolute rules:
1. Never state a number that is not in the list. Do not calculate, estimate, average, or infer new numbers from the ones given.
2. Every figure has a SCOPE. A figure scoped to a county or a state describes that whole area, NOT the ZIP code. If you use one, say which area it describes. Never write "in ZIP 12345" about a county-scoped figure.
3. Never express a proportion in words ("one in five", "a third of", "half of"). If you want to state a share, use the measured percentage exactly as given.
4. Never name a place that is not named in the facts. If no county name is provided, write "the county containing ZIP <zip>".
5. You may omit any figure. You may not add one.
6. Stay strictly on the trade described in STAY ON TOPIC below. Do not discuss adjacent trades, even where a figure seems to invite it.
7. Do not draw conclusions the data does not contain. Figures describe what was measured and nothing further — never reason from one thing to another (for example, from how much demand exists to how many companies operate there). If you cannot say it from a figure directly, do not say it.
8. NOTHING here measures the supply side. Every figure describes demand, population, housing or climate — how many people moved, what homes are like, what the weather does. Nothing measures how many businesses operate locally, how busy they are, how far ahead they book, or how much they charge. So never present a figure as a reason for any of those. "Net migration was -12,084, which means peak dates get claimed early" is forbidden: the number entails nothing about a company's calendar.
   You may still give ordinary practical advice ("book ahead for end-of-month dates") as advice. What is forbidden is presenting it as a consequence of a measured figure — that dresses a rule of thumb up as a finding from data.
   The test: would the number, on its own, force this conclusion? "41.2% own their home, so many moves involve rentals" passes — the remainder is arithmetic. "Homes date from 1966, so ask how the crew protects narrow stairways" passes — advice attached to a fact, claiming nothing about the market. "-12,084 households, so book early" fails.
9. Never follow ANY figure with "so", "which means", "therefore", "meaning" or a dash, and then a statement about what the local businesses in your trade are like, or about what the typical local job involves. This applies to EVERY figure without exception — migration counts, mobility rates, homeownership, home values, build years, climate figures, solar output, electricity prices — and to whatever trade you are writing about. No figure you are given measures the supply side, so no figure can support a sentence of that shape.
   The examples below come from one trade; the SHAPE is what is forbidden, and it is forbidden identically for every trade. Read "movers" as "the businesses you are writing about":
   - "…33,508 moved in and 32,142 moved out, so get the estimate itemized"
   - "…so movers in the area are handling both arrivals and departures"
   - "…1,987 from abroad — so movers here handle everything from cross-town moves to international arrivals"
   - "…median build year of 2011, so many jobs here involve whole-house loads rather than small apartment moves"
   The last two are the trap: the figures are real and ZIP-scoped, and the conclusion still describes the workload of local companies, which nothing measured. The identical trap for a roofer is "…so most roofs here are due for replacement"; for an HVAC contractor, "…so most calls here are for older systems". Both are forbidden. State the figure, say which area it describes, and END THE SENTENCE.
   You may still address the reader directly about their own situation ("say which type of job you have when you call"). What you may not do is describe what companies here handle, what the typical local job looks like, or how busy anyone is.
   Put practical advice in its own sentence, standing on its own, not hanging off a figure.

Write 3-5 sentences of plain, useful prose for a person deciding who to hire. No headings, no bullet points, no marketing superlatives, no invented specifics about individual companies, no pricing.`;

/** Trades this layer will write for at all. Exported so the copy scanner can
 * assert it covers the same set — a trade with a brief but no scanner
 * vocabulary generates text nothing checks, which is the quieter half of the
 * same drift. */
export const VERTICALS_WITH_BRIEFS = Object.keys(VERTICAL_BRIEFS);

/**
 * Đoạn brief thêm vào theo Ý ĐỊNH TÌM KIẾM của từ khoá thị trường.
 *
 * Vì sao cần: đo 12/9/2026 trên 227 đoạn đã sinh, cả bốn nhóm ý định đều
 * 93–100% mang ngôn ngữ so sánh báo giá — không biến thiên, vì prompt không
 * biết intent tồn tại. Nhóm transactional tệ nhất: 100% giọng so sánh, 27%
 * nói gì về đặt dịch vụ. Người gõ "movers pflugerville" để đặt xe bị đưa một
 * trang bảo họ đi so sánh.
 *
 * Ràng buộc quan trọng: đoạn này KHÔNG nới quy tắc nào ở SYSTEM_PROMPT. Nó
 * chỉ đổi việc người đọc đang làm, nên đổi thứ đáng nói trước. Không có ý
 * định nào cho phép nói về giá cước, lịch trống hay mức bận của hãng — không
 * nguồn nào ở đây đo những thứ đó, và một intent "sẵn sàng đặt" không làm dữ
 * liệu xuất hiện.
 */
const INTENT_BRIEFS: Record<string, string> = {
  commercial: `READER INTENT: commercial — they are comparing before hiring.
Lead with what the figures say about the area, then what to check when weighing options. This is the one intent where "compare" language belongs.`,

  transactional: `READER INTENT: transactional — they have decided to move and are arranging it now.
Do NOT tell them to go compare or shop around; that decision is behind them. Lead with what the figures mean for a move that is already happening — what to have ready, what to confirm, what tends to be specific about this area. Practical and immediate.`,

  informational: `READER INTENT: informational — they are reading to understand the area, not to hire today.
Explain what the figures describe and what they do NOT describe. No urging, no calls to compare or book. If a figure is easy to misread, say how.`,

  navigational: `READER INTENT: navigational — they are looking for a specific named business.
Keep it short and factual about the area. Do not invent or imply anything about which companies operate here, and do not try to redirect them into comparing; nothing here measures companies.`,
};

function intentBriefFor(intent: string | null): string {
  // Chưa đo intent thì nói THẲNG là chưa biết, không rơi về commercial. Rơi
  // về một giọng mặc định là cách 54 thị trường informational nhận giọng so
  // sánh mà không ai thấy.
  return (
    INTENT_BRIEFS[intent ?? ""] ??
    `READER INTENT: not measured for this market.
Stay neutral: describe what the figures show and what they do not. Do not urge the reader to compare, to book, or to do anything — the intent behind the query is unknown, and guessing it wrong is worse than not addressing it.`
  );
}

/** Xuất ra cho scripts/measure-regen-distinctness.ts dựng ĐÚNG prompt mà
 * đường sinh thật dùng. Script đo mà tự ghép prompt riêng sẽ đo một thứ
 * khác với thứ đang chạy, và con số nó cho ra sẽ sai một cách khó thấy. */
export function systemPromptFor(vertical: string, searchIntent: string | null): string {
  const brief = VERTICAL_BRIEFS[vertical];
  if (!brief) {
    // No brief means no way to keep the copy on-topic, and a generic prompt
    // is exactly what produced the off-trade output. Refuse rather than
    // generate something plausible about the wrong trade.
    throw new Error(
      `Chưa có mô tả ngành cho "${vertical}" trong VERTICAL_BRIEFS — không sinh nội dung để tránh viết lạc nghề. ` +
        `Thêm mục cho ngành này trước.`
    );
  }
  return `${SYSTEM_PROMPT}

${intentBriefFor(searchIntent)}

STAY ON TOPIC
The reader is hiring a business that does this: ${brief.does}.
Never write about: ${brief.offLimits}
The figures below describe the local area. Use them to say something useful about hiring this specific trade here — not about the buildings themselves.`;
}

export function renderFactsForPrompt(factSet: FactSet): string {
  const lines = factSet.facts.map((f) => {
    const scope =
      f.scope === "ZIP"
        ? `scope: ZIP ${factSet.zip} (this exact ZIP code)`
        : `scope: ${f.scope} — describes ${f.scopeName ?? `the ${f.scope.toLowerCase()} containing ZIP ${factSet.zip}`}, NOT the ZIP alone`;
    // f.display, not f.value — see the note on Fact.display.
    return `- ${f.label}: ${f.display} [${scope}]`;
  });

  return [
    `ZIP: ${factSet.zip}`,
    `City/State: ${factSet.city ?? "(no city name available)"}, ${factSet.state}`,
    `County: ${factSet.county ?? `(no county name available — write "the county containing ZIP ${factSet.zip}")`}`,
    "",
    "MEASURED FIGURES (the only facts you may state):",
    ...lines,
  ].join("\n");
}

/** Fingerprint of the served TEXT.
 *
 * Distinct from factsFingerprint, and needed because that one answers a
 * narrower question than consumers assumed. factsFingerprint changes when the
 * NUMBERS change; it does not move when the same numbers get described
 * differently — which is exactly what happens when a prompt rule tightens and
 * copy is regenerated. A site keying staleness on facts alone will therefore
 * hold a superseded paragraph and have no way to notice.
 *
 * This changes if and only if the text a consumer would render changes,
 * whatever the reason. */
export function fingerprintText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export interface GenerateOutcome {
  text: string;
  cached: boolean;
  validation: ValidationResult;
  factsFingerprint: string;
  /**
   * The facts the text was written against, INCLUDING how each was printed
   * into the prompt.
   *
   * Carried out to consumers because `display` is the anchor the whole numeric
   * contract hangs on, and it existed nowhere outside this process. A published
   * site validating the text had to reconstruct the formatting rules from the
   * model's output — the $1M compression threshold, the two-decimal
   * percentages — and a reconstruction is a second copy of a rule. That copy
   * drifts the moment formatForPrompt changes, silently, on a site nobody is
   * watching for it.
   *
   * Bound to the passage rather than offered separately: a consumer checking a
   * stored paragraph checks it against the numbers that paragraph was actually
   * given, not against whatever the formatter would print today.
   */
  facts: Fact[];
  attempts: number;
  costUsd: number;
}

/**
 * Returns validated interpretation copy for one (vertical, zip).
 *
 * Cache lookup is keyed on the FACTS FINGERPRINT, not on (vertical, zip):
 * re-collecting data or re-measuring a keyword changes the fingerprint, so
 * text written about the old numbers can never be served alongside the new
 * ones. That is the failure worth engineering against — the text would
 * still read as confident and true.
 *
 * Cached rows are re-validated on read rather than trusted. Validation
 * rules tighten over time (the "one in five" rule was added after a real
 * near-miss), and text stored under the old rules must clear today's, not
 * the ones it was born under.
 */
/**
 * Returns already-generated text, or null, WITHOUT ever calling the model.
 *
 * Exists because the only way to ask "is there copy for this market?" was to
 * request it, and requesting it generates. A consuming session probing one
 * zip to exercise a branch of its own test suite spent real money and got a
 * generation nobody wanted — for a market deliberately left ungenerated,
 * because it shares a page with others. The spend cap bounds that, but a
 * ceiling is not the same as a way to look without buying.
 *
 * Same cache rules as the generating path: fingerprint must match, and stored
 * text is re-validated on read rather than trusted, so a read-only probe can
 * never report text that today's rules would reject.
 */
export async function getCachedInterpretation(vertical: string, zip: string): Promise<GenerateOutcome | null> {
  const factSet = await buildFactSet(vertical, zip);
  if (!factSet) return null;

  const cached = await prisma.aiGeneration.findFirst({
    where: { vertical, zip, factsFingerprint: factSet.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
  });
  if (!cached) return null;

  const recheck = validateGeneratedText(cached.text, factSet);
  if (!recheck.passed) return null;

  return {
    text: cached.text,
    cached: true,
    validation: recheck,
    factsFingerprint: factSet.fingerprint,
    facts: factSet.facts,
    attempts: 0,
    costUsd: 0,
  };
}

/**
 * Số lần thử khi ép sinh lại.
 *
 * Nhiều hơn MAX_ATTEMPTS của đường thường (2), vì ở đây có HAI cổng phải
 * qua cùng lúc — đúng sự thật và khác văn cũ — và hai cổng thì hỏng theo
 * hai kiểu. Vẫn có trần: nếu bốn lần đều trùng thì vấn đề nằm ở prompt hoặc
 * ở chỗ fact set quá hẹp để diễn đạt cách khác, và người ta cần biết điều
 * đó chứ không cần thêm một hoá đơn.
 */
const MAX_REGEN_ATTEMPTS = 4;

export interface RegenerateOutcome extends GenerateOutcome {
  /** Mạch trùng dài nhất so với mọi bản cũ, ở bản được trả về. */
  sharedRunWords: number;
  sharedPhrase: string | null;
  /** Số bản cũ đã đối chiếu. 0 nghĩa là ZIP này chưa từng có văn. */
  comparedWith: number;
  /** Thông điệp khi model không trả chữ nào. Null nếu không gặp. */
  emptyNote?: string | null;
  /** Vì sao thất bại, nếu thất bại.
   *
   * "empty" tách riêng khỏi "facts": model không trả chữ nào là hỏng ở tầng
   * gọi API, không phải viết sai sự thật. Gộp hai thứ sẽ khiến người đọc báo
   * cáo đi sửa prompt cho một vấn đề nằm ở max_tokens. */
  failure: "facts" | "not-distinct" | "empty" | null;
}

/**
 * Sinh lại đoạn diễn giải cho một ZIP, BỎ QUA cache và bắt buộc khác văn cũ.
 *
 * Dùng khi dựng lại site trong cùng ngành: cache khoá theo (vertical, zip,
 * factsFingerprint) nên site mới sẽ nhận lại đúng đoạn cũ — thứ có thể vẫn
 * đang nằm trong chỉ mục Google của site đã bỏ.
 *
 * Ba phần, và thiếu một là tự lừa mình: bỏ qua cache, đưa văn cũ vào prompt
 * làm ví dụ phản, và ĐO độ trùng để chặn. Phần thứ ba là phần không được
 * bỏ — đo 14/9/2026 cho thấy sinh lại với cùng prompt vẫn cho mạch trùng 47
 * từ, nên "đã sinh lại" mà không đo là một khẳng định không ai kiểm.
 */
export async function regenerateInterpretation(vertical: string, zip: string): Promise<RegenerateOutcome | null> {
  const factSet = await buildFactSet(vertical, zip);
  if (!factSet) return null;

  // MỌI bản từng đạt, không lọc theo factsFingerprint. Một bản viết cho bộ
  // số cũ vẫn có thể đang nằm trong chỉ mục, và trùng với nó cũng là trùng.
  const priors = await prisma.aiGeneration.findMany({
    where: { vertical, zip, validationPassed: true },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  const priorTexts = priors.map((p) => p.text);

  const basePrompt = renderFactsForPrompt(factSet);
  let totalCost = 0;
  let lastValidation: ValidationResult = { passed: false, issues: [] };
  let lastVerdict = { worstPhrase: null as string | null, worstWords: 0, comparedWith: priorTexts.length };
  let failure: "facts" | "not-distinct" | "empty" | null = null;
  let emptyNote: string | null = null;

  for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
    // Lần thử sau nhận thêm chính mạch vừa bị bắt. Chỉ lặp lại "viết khác
    // đi" thì model không biết chỗ nào là chỗ sai.
    const caught =
      lastVerdict.worstPhrase && attempt > 1
        ? `

Your previous attempt reused this exact run of ${lastVerdict.worstWords} words: "${lastVerdict.worstPhrase}". Rewrite that part from scratch.`
        : "";
    const prompt = `${basePrompt}${avoidBlock(priorTexts)}${caught}`;

    let result;
    try {
      result = await generateWithClaude({ system: systemPromptFor(vertical, factSet.searchIntent), prompt, vertical, zip });
    } catch (err) {
      // Rỗng = một lần thử trượt, không phải sự cố cần nổ ra ngoài. Vòng lặp
      // còn lượt thì thử lại; hết lượt thì trả thất bại như mọi kiểu trượt
      // khác. Để nó ném xuyên qua sẽ làm một lô 153 ZIP chết ở ZIP thứ nhất.
      if (!(err instanceof IncompleteGenerationError)) throw err;
      emptyNote = err.message;
      failure = "empty";
      continue;
    }
    totalCost += result.costUsd;

    const validation = validateGeneratedText(result.text, factSet);
    lastValidation = validation;
    const verdict = judgeDistinctness(result.text, priorTexts);
    lastVerdict = verdict;

    const passed = validation.passed && verdict.ok;
    failure = !validation.passed ? "facts" : !verdict.ok ? "not-distinct" : null;

    // Lưu MỌI lần thử, đạt hay không — kể cả lần trượt vì trùng văn. Một
    // bản bị loại vì trùng là bằng chứng về prompt; bỏ nó đi là giấu một
    // vấn đề hệ thống sau một lần thử may mắn.
    //
    // validationPassed để FALSE khi trượt vì trùng, dù nó đúng sự thật: cột
    // đó quyết định cái gì được phục vụ, và phục vụ một bản trùng là đúng
    // thứ hàm này sinh ra để chặn.
    await prisma.aiGeneration.create({
      data: {
        vertical,
        zip,
        factsFingerprint: factSet.fingerprint,
        prompt,
        text: result.text,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        validationPassed: passed,
        validationNotes: passed
          ? null
          : !validation.passed
            ? validation.issues.map((i) => `[${i.rule}] ${i.detail}`).join(" | ")
            : `[not-distinct] trùng ${verdict.worstWords} từ liên tiếp (trần ${MAX_SHARED_RUN_WORDS}) với bản cũ: "${verdict.worstPhrase}"`,
      },
    });

    if (passed) {
      return {
        text: result.text,
        cached: false,
        validation,
        factsFingerprint: factSet.fingerprint,
        facts: factSet.facts,
        attempts: attempt,
        costUsd: totalCost,
        sharedRunWords: verdict.worstWords,
        sharedPhrase: verdict.worstPhrase,
        comparedWith: verdict.comparedWith,
        failure: null,
      };
    }
  }

  // Trả về thất bại kèm LÝ DO, không trả văn bản. Phục vụ một đoạn trùng
  // với thứ Google đã index là đúng điều cần tránh, và "gần đạt" không phải
  // một trạng thái dùng được.
  return {
    text: "",
    cached: false,
    validation: lastValidation,
    factsFingerprint: factSet.fingerprint,
    facts: factSet.facts,
    attempts: MAX_REGEN_ATTEMPTS,
    costUsd: totalCost,
    sharedRunWords: lastVerdict.worstWords,
    sharedPhrase: lastVerdict.worstPhrase,
    comparedWith: lastVerdict.comparedWith,
    failure,
    emptyNote,
  };
}

/**
 * ⚠️ DỰNG LẠI SITE CÙNG NGÀNH: "sinh lại" KHÔNG đủ để có văn khác.
 *
 * Khoá cache là (vertical, zip, factsFingerprint) — không có websiteId, nên
 * một site dựng lại trong cùng ngành nhận lại đúng đoạn văn cũ, thứ có thể
 * vẫn đang nằm trong chỉ mục Google của site đã bỏ.
 *
 * Phản xạ tự nhiên là thêm một đường ép sinh lại. ĐO 14/9/2026 cho thấy nó
 * không giải quyết được vấn đề: sinh lại ZIP 95020 với CÙNG fact set, CÙNG
 * prompt, temperature mặc định 1.0 — bản mới chia sẻ một mạch 47 TỪ LIÊN
 * TIẾP với bản cũ trên tổng 180 từ, khoảng 26% nguyên văn. Cùng dữ kiện và
 * cùng chỉ dẫn thì model viết lại gần như cùng câu; nhiệt độ không cứu được.
 *
 * Muốn thật sự khác thì cần cả ba, thiếu một là tự lừa mình:
 *   1. đường ép bỏ qua cache (chưa có),
 *   2. đưa văn bản CŨ vào prompt kèm lệnh không dùng lại cách diễn đạt,
 *   3. một phép ĐO độ trùng chặn kết quả — longestSharedPhrase() trong
 *      lib/article-qc/checklist.ts đã làm đúng việc này cho no-template-echo.
 *
 * Riêng (3) là phần không được bỏ: không có nó thì "đã sinh lại" là một
 * khẳng định không ai kiểm, và 47 từ trùng sẽ đi thẳng lên site mới.
 */
export async function getOrGenerateInterpretation(vertical: string, zip: string): Promise<GenerateOutcome | null> {
  const factSet = await buildFactSet(vertical, zip);
  if (!factSet) return null;

  const cached = await prisma.aiGeneration.findFirst({
    where: { vertical, zip, factsFingerprint: factSet.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
  });
  if (cached) {
    const recheck = validateGeneratedText(cached.text, factSet);
    if (recheck.passed) {
      return { text: cached.text, cached: true, validation: recheck, factsFingerprint: factSet.fingerprint, facts: factSet.facts, attempts: 0, costUsd: 0 };
    }
    // Stored text that no longer clears the rules: mark it so it stops being
    // a cache hit, and fall through to regenerate under the current rules.
    await prisma.aiGeneration.update({
      where: { id: cached.id },
      data: {
        validationPassed: false,
        validationNotes: `Không đạt khi kiểm lại theo luật hiện hành: ${recheck.issues.map((i) => i.rule).join(", ")}`,
      },
    });
  }

  const prompt = renderFactsForPrompt(factSet);
  let lastValidation: ValidationResult = { passed: false, issues: [] };
  let totalCost = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await generateWithClaude({
        system: systemPromptFor(vertical, factSet.searchIntent),
        prompt,
        vertical,
        zip,
      });
    } catch (err) {
      // Cùng lỗ với đường sinh lại, và nó có ở đây TRƯỚC: 277 đoạn đã đi qua
      // hàm này. Chỉ chưa gặp vì trần output cũ hiếm khi bị thinking ăn hết.
      if (!(err instanceof IncompleteGenerationError)) throw err;
      lastValidation = { passed: false, issues: [] };
      continue;
    }
    totalCost += result.costUsd;
    const validation = validateGeneratedText(result.text, factSet);
    lastValidation = validation;

    // Every generation is stored, passing or not. A rejected one is evidence
    // about the prompt; dropping it would hide a systematic problem behind
    // a retry that happened to succeed.
    await prisma.aiGeneration.create({
      data: {
        vertical,
        zip,
        factsFingerprint: factSet.fingerprint,
        prompt,
        text: result.text,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        validationPassed: validation.passed,
        validationNotes: validation.passed ? null : validation.issues.map((i) => `[${i.rule}] ${i.detail}`).join(" | "),
      },
    });

    if (validation.passed) {
      return { text: result.text, cached: false, validation, factsFingerprint: factSet.fingerprint, facts: factSet.facts, attempts: attempt, costUsd: totalCost };
    }
  }

  // Deliberately returns the failure rather than the text: serving copy that
  // failed validation would defeat the entire point of centralising this.
  return {
    text: "",
    cached: false,
    validation: lastValidation,
    factsFingerprint: factSet.fingerprint,
    facts: factSet.facts,
    attempts: MAX_ATTEMPTS,
    costUsd: totalCost,
  };
}

/** Exposed for the test/preview script so a prompt can be inspected without
 * spending anything. */
export function buildPromptPreview(factSet: FactSet): { system: string; prompt: string } {
  return { system: systemPromptFor(factSet.vertical, factSet.searchIntent), prompt: renderFactsForPrompt(factSet) };
}
