// Các mẫu lỗi mà validator số học KHÔNG nhìn thấy, và từ vựng nghề mà chúng
// được dựng lên từ đó.
//
// TÁCH RA KHỎI scripts/scan-generated-copy.ts NGÀY 2026-09-10, và lý do tách
// đúng bằng lý do lib/content-rules/registry.ts tồn tại: cùng bộ mẫu này giờ
// có HAI nơi cần chạy nó — một nơi quét văn model sinh còn nằm trong DB, một
// nơi quét HTML site đã publish (scripts/scan-rendered-content.ts). Chép regex
// sang nơi thứ hai là tạo bản sao thứ ba của một luật, và hai bản sao trôi
// lệch mà không ai thấy.
//
// KHÔNG có gì ở đây được viết mới khi tách. Toàn bộ nội dung, kể cả chú thích,
// là nguyên văn từ scan-generated-copy.ts — chỉ đổi chỗ ở và thêm `export`.

export interface Pattern {
  name: string;
  why: string;
  test: RegExp;
  /** True when the pattern is BUILT from this trade's vocabulary, so proving
   * it for one trade proves nothing for another.
   *
   * seo_leak and migration_bridge are the same static regex for all 13
   * trades — one fixture anywhere proves them everywhere, and demanding a
   * per-trade fixture for them would print a warning that is always true and
   * never actionable. Warnings that are always on get skimmed, and skimming
   * is how the real one gets missed. */
  verticalSpecific: boolean;
  /** Metric prefix a market must actually have for this pattern to have
   * anything to catch, or null when the pattern applies to any prose.
   *
   * This answers a question coverage cannot: "has this rule ever fired" and
   * "can this rule fire at all" are different, and only the first is testable
   * with fixtures. migration_bridge looks for claims hung off migration
   * figures — a market with no IRS data never receives such a figure, so the
   * pattern is inert there no matter what the model writes, and its zero
   * means "nothing to look at" rather than "checked and clean".
   *
   * Counting OPPORTUNITIES would not separate these: every text pattern has
   * an opportunity on every passage, so that number is just the passage
   * count. The discriminating thing is the DATA PRECONDITION — which facts
   * must exist before the rule has any surface at all. (Framing from the site
   * session, which reached it after trying the opportunity count and finding
   * it told them nothing.) */
  requiresMetricPrefix: string | null;
}

/**
 * The vocabulary that BELONGS to each trade, plus the nouns its providers go
 * by.
 *
 * Off-trade is then derived, never hand-written: for vertical V it is the
 * vocabulary of every trade EXCEPT V. That derivation is the whole point. The
 * first version of this file hard-coded one off-trade list — "plumbing,
 * HVAC, roofing, furnace…" — which was right for moving-services and
 * catastrophically wrong everywhere else: run it on roofing-replacement and
 * the word "roofing" itself is flagged, so correct copy reports as 100%
 * off-trade and the real problems are buried under the noise. Exactly the
 * bug this scan exists to find, living in the scanner.
 *
 * Deriving it means a trade's own words CANNOT be off-limits for it, as a
 * property of the construction rather than something to remember.
 */
export const TRADE_VOCAB: Record<
  string,
  {
    terms: string[];
    providers: string[];
    /** Off-limits for THIS trade only. */
    alsoOffLimits?: string[];
    /** Plain sample words this trade may legitimately borrow from another
     * trade. Any foreign term whose pattern matches one of these is dropped
     * from its off-trade list.
     *
     * Needed because trades share vocabulary honestly: a solar installer has
     * to talk about your ROOF — that is where the panels go — and flagging
     * it would be the roofing bug in reverse. Derivation alone cannot know
     * this; it has to be stated. */
    alsoAllowed?: string[];
  }
> = {
  "moving-services": {
    // "movers" must not match "AIR movers" — the standard name for the fans a
    // water-damage crew sets up. Without the lookbehind, correct restoration
    // copy reads as moving-company copy.
    terms: ["moving", "(?<!air\\s)movers?", "packing", "pack and load", "van line", "relocation"],
    providers: ["(?<!air\\s)movers?", "moving compan(y|ies)"],
    // Warranties are off-limits HERE specifically: a mover does not warrant
    // your house. For a roofer, an HVAC contractor or a solar installer,
    // warranty terms are a central and legitimate thing to compare — which
    // is why this cannot live in the global list below.
    alsoOffLimits: ["warrant(y|ies)", "routine servic\\w*", "maintenance schedul\\w*"],
  },
  "hvac-repair": {
    terms: ["HVAC", "furnace", "air.condition\\w*", "heat pump", "ductwork", "thermostat", "heating system"],
    providers: ["HVAC (contractors?|technicians?)", "technicians?"],
  },
  "roofing-replacement": {
    terms: ["roof(ing|s|er|ers)?", "shingles?", "gutters?", "flashing", "underlayment"],
    providers: ["roofers?", "roofing (contractors?|compan(y|ies))"],
  },
  "water-damage-restoration": {
    terms: ["water damage", "drying", "dehumidif\\w*", "mold", "restoration", "moisture reading"],
    providers: ["restoration (compan(y|ies)|contractors?)"],
  },
  "garage-door-repair": {
    terms: ["garage door", "door opener", "torsion spring", "track alignment"],
    providers: ["garage door (technicians?|compan(y|ies))"],
  },
  "pest-control": {
    terms: ["pests?", "rodents?", "termites?", "infestation", "exterminat\\w*", "insects?"],
    providers: ["exterminators?", "pest control compan(y|ies)"],
  },
  "solar-installation": {
    terms: ["solar", "photovoltaic", "solar panels?", "inverter", "net metering"],
    providers: ["solar installers?", "installers?"],
    // Panels are mounted on the roof; its pitch, orientation and shading are
    // the central variables in a solar quote.
    alsoAllowed: ["roof", "roofs"],
  },
};

/** Home-maintenance words no trade here owns, so they are off-limits for all
 * of them unless a trade claims them above. */
const UNOWNED_MAINTENANCE = ["plumbing", "plumbers?", "wiring", "electrical system", "renovat\\w*", "remodel\\w*", "water heater"];

/** Provider nouns that apply to any trade — used by the supply-side rule so
 * it works without knowing which trade it is reading. */
const GENERIC_PROVIDERS = ["providers?", "companies", "contractors?", "firms?", "operators?", "businesses", "crews?"];

export function patternsFor(vertical: string): Pattern[] {
  const own = TRADE_VOCAB[vertical];
  if (!own) {
    // Same discipline as systemPromptFor(): without a vocabulary there is no
    // way to tell on-trade from off-trade, and a scan that cannot tell them
    // apart produces a number that looks like a result but is not one.
    throw new Error(
      `Chưa có từ vựng nghề cho "${vertical}" trong TRADE_VOCAB — không quét, vì không phân biệt được đúng nghề với lạc nghề. Thêm mục cho ngành này trước.`
    );
  }
  const ownTerms = new Set(own.terms);
  const allowedSamples = own.alsoAllowed ?? [];
  const foreign = Object.entries(TRADE_VOCAB)
    .filter(([v]) => v !== vertical)
    .flatMap(([, v]) => v.terms)
    .concat(UNOWNED_MAINTENANCE)
    .concat(own.alsoOffLimits ?? [])
    .filter((t) => !ownTerms.has(t))
    .filter((t) => !allowedSamples.some((sample) => new RegExp(`^(?:${t})$`, "i").test(sample)));

  const providers = [...own.providers, ...GENERIC_PROVIDERS].join("|");

  return [
    {
      name: "seo_leak",
      requiresMetricPrefix: null,
      verticalSpecific: false,
      why: "Nói về từ khoá/lượt tìm kiếm — đây là số liệu nội bộ, người đọc không dùng đến, và in ra là tự khai trang do máy viết.",
      test: /\b(search(es|ed)?\s+(volume|per\s+month|monthly)|monthly\s+searches|search\s+volume|keyword|query volume|SEO|ranks?\s+for)\b/i,
    },
    {
      name: "off_trade",
      requiresMetricPrefix: null,
      verticalSpecific: true,
      why: `Viết sang nghề khác — dữ liệu nhà ở gợi ý bảo trì, nhưng "${vertical}" không làm việc đó.`,
      test: new RegExp(`\\b(${[...new Set(foreign)].join("|")})\\b`, "i"),
    },
    {
      name: "migration_bridge",
      requiresMetricPrefix: "irs_migration",
      verticalSpecific: false,
      why: "Treo bất cứ thứ gì lên số di cư — số đó tả hộ khai thuế trên cả county, không kéo theo lời khuyên hay nhận định nào.",
      // Deliberately kept narrow to MIGRATION figures, matching what prompt
      // rule 9 actually forbids outright.
      //
      // Widening it to "homeownership|build year|median value" was tried and
      // reverted: it flagged "the homeownership rate is 42.2%, meaning the
      // majority of households are renters", which rule 8 explicitly PERMITS
      // as arithmetic. A scan that flags permitted sentences trains the
      // reader to skim, and skimming is how the real hit gets missed. The
      // general "figure -> claim about companies" case is caught by
      // supply_side_claim below, by its consequent rather than its subject.
      test: /\b(moved\s+(in|out)|migration|households?\s+(that\s+)?(moved|left|arrived)|net\s+(loss|gain))\b[^.!?]{0,140}\b(so|which\s+means|therefore|meaning|as\s+a\s+result|that\s+means)\b/i,
    },
    {
      name: "supply_side_claim",
      requiresMetricPrefix: null,
      verticalSpecific: true,
      why: "Khẳng định về phía cung (công ty ở đây làm loại việc gì, bận ra sao, giá thế nào) — KHÔNG nguồn nào trong dataset đo phía cung.",
      // "several movers" alone is not a claim: "call several movers and
      // compare quotes" is advice to the reader, which rule 8 explicitly
      // permits, and flagging it buries the real hits. So the
      // count-of-companies branch requires that the reader is NOT being told
      // to contact them.
      test: new RegExp(
        `(?<!\\b(?:call|calling|contact|ask|asking|get|getting|from|compare|comparing)\\s)\\b(several|many|plenty\\s+of|numerous|competing)\\s+(local\\s+)?(${providers})\\b` +
          `|\\b(${providers}|jobs?)\\s+(here|locally|in\\s+(the\\s+)?(area|this\\s+ZIP))\\s+(are|tend|get|book|stay|charge|handle|involve|do)\\b` +
          // Any quantifier, not just "many". The first version required the
          // word "many" and so walked straight past "so SOME jobs involve
          // rental units" in a water-damage generation — the same claim about
          // local workload, one adjective different. Quantifier-specific
          // rules are the narrow-scope bug in miniature.
          `|\\b(some|many|most|several|plenty\\s+of|a\\s+lot\\s+of|a\\s+share\\s+of)\\s+(local\\s+)?jobs?\\s+(here\\s+)?(involve|are|tend|will\\s+be)\\b` +
          `|\\b(book|calendar|slots?|availability|capacity)\\s+(fills?|fill\\s+up|get\\s+claimed|is\\s+tight)\\b` +
          `|\\bhigh\\s+demand\\s+means\\b|\\bcompetitive\\s+market\\b`,
        "i"
      ),
    },
  ];
}
