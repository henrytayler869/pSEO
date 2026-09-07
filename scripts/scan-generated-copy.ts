// Scans every stored, passing generation for the four failure patterns the
// validator CANNOT see.
//
// This exists because "validator green" has been mistaken for "content
// correct" three separate times in this project, and every time the text was
// wrong in a way no numeric check could catch:
//
//   - moving-services copy discussing plumbing, roofing and warranties
//     (46% of texts) — every number in it was real
//   - search volume printed as reader copy (83%) — a real measurement, but
//     internal SEO telemetry, not something a person hiring movers needs
//   - "2,400 searches, so expect several providers competing" — a claim
//     about SUPPLY inferred from a measurement of DEMAND, stated in words
//     where the numeric validator has nothing to compare
//
// So this is not a linter for style. It is the check for the class of error
// the validator is structurally blind to: sentences that are false, or
// off-trade, while containing no wrong number. It reports; it never edits.
//
// Usage: tsx scripts/scan-generated-copy.ts <vertical>

import { prisma } from "../lib/db/prisma";
import { VERTICALS_WITH_BRIEFS } from "../lib/ai/generate";
import { getRealDataPointsForZipAndVertical } from "../lib/queries/collector";

interface Pattern {
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
const TRADE_VOCAB: Record<
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

function patternsFor(vertical: string): Pattern[] {
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

/**
 * Sentences that actually shipped, before the prompt was fixed. Each one must
 * be caught by the pattern it is filed under.
 *
 * This exists because a scan that reports "0 found" is worthless unless the
 * scanner is known to find things, and the first run of this script reported
 * exactly that — across 123 stored generations, including old ones. That is
 * either a fixed prompt or a broken regex, and the output looks identical
 * either way. These fixtures decide which, every run, before any result is
 * printed.
 */
const KNOWN_BAD: { vertical: string; pattern: string; text: string }[] = [
  { vertical: "moving-services", pattern: "off_trade", text: "Homes here date from 1966, so ask about plumbing, wiring, and heating systems before you commit." },
  { vertical: "moving-services", pattern: "off_trade", text: "Check the roofing and any remaining warranty terms on recent work." },
  { vertical: "moving-services", pattern: "seo_leak", text: "The main keyword draws 18,100 monthly searches, so it is reasonable to compare several quotes." },
  { vertical: "moving-services", pattern: "supply_side_claim", text: "That volume suggests you should expect several providers competing for the same calls." },
  { vertical: "moving-services", pattern: "supply_side_claim", text: "Movers here are handling both arrivals and departures." },
  { vertical: "moving-services", pattern: "supply_side_claim", text: "So movers here handle everything from cross-town moves to international arrivals." },
  { vertical: "moving-services", pattern: "supply_side_claim", text: "The median build year is 2011, so many jobs here involve whole-house loads." },
  { vertical: "moving-services", pattern: "migration_bridge", text: "Some 33,508 households moved in and 32,142 moved out, so get the estimate itemized." },
  { vertical: "moving-services", pattern: "migration_bridge", text: "Net migration was -12,084, which means peak dates get claimed early." },
  // Real output, and the reason this scan is run per trade rather than once:
  // the identical forbidden shape appeared in a DIFFERENT trade, with "some"
  // where moving-services had said "many".
  { vertical: "water-damage-restoration", pattern: "supply_side_claim", text: "Homeownership in this ZIP is 71.0%, so some jobs involve rental units." },
  // The trade-specific traps named in prompt rule 9.
  { vertical: "roofing-replacement", pattern: "supply_side_claim", text: "The median build year is 1993, so most jobs here are full tear-offs rather than repairs." },
  { vertical: "hvac-repair", pattern: "supply_side_claim", text: "Homes date from 1993, so many jobs here involve aging systems near the end of their life." },
  { vertical: "solar-installation", pattern: "supply_side_claim", text: "Radiation here is 6.04 kWh, so many jobs here involve large south-facing arrays." },
  { vertical: "water-damage-restoration", pattern: "supply_side_claim", text: "With 8 declarations on record, several local restoration companies specialise in storm losses." },

  // off_trade, per trade. These are the ONLY pattern besides supply_side that
  // is built from the trade's own vocabulary, so a fixture from another trade
  // proves nothing here. Each names a neighbouring trade the data would
  // plausibly tempt the model toward — housing figures suggest maintenance,
  // and maintenance belongs to whichever trade actually does it.
  { vertical: "roofing-replacement", pattern: "off_trade", text: "Ask the crew about the furnace and ductwork while they are in the attic." },
  { vertical: "hvac-repair", pattern: "off_trade", text: "Ask whether they also handle the roof flashing and any shingle damage above the unit." },
  { vertical: "water-damage-restoration", pattern: "off_trade", text: "Ask about remodelling the kitchen and rewiring while the walls are open." },
  { vertical: "solar-installation", pattern: "off_trade", text: "Ask the installer to check the furnace and ductwork at the same visit." },
];

/**
 * Sentences that are CORRECT and must not be flagged.
 *
 * The counterweight to KNOWN_BAD, and the harder half to write. A pattern
 * broad enough to catch everything flags correct copy too, and that failure
 * is quieter than the one it replaces: an over-broad rule does not error or
 * fail a build, it silently discards good writing. The site session lost a
 * page that way and only noticed by counting 126 against an expected 127.
 *
 * Every entry here is REAL OUTPUT that passed, not a sentence invented for
 * the test. That distinction came from the site session and is the point: you
 * can imagine how a model gets something wrong, but you cannot reliably
 * imagine the shapes it uses when it gets things RIGHT — so invented
 * good-cases test a narrower space than the model actually occupies, and the
 * false positive hides in the gap.
 */
const KNOWN_GOOD: { vertical: string; text: string }[] = [
  // Real output. Advice to the reader, not a claim about how many movers
  // exist — rule 8 permits this explicitly.
  {
    vertical: "moving-services",
    text: "If your lease turns over at the end of a month, it's worth calling several movers well in advance and getting each estimate itemized in writing.",
  },
  // Real output. Arithmetic on a measured share, which rule 8 permits, and
  // the case that forced migration_bridge to stay narrow.
  { vertical: "moving-services", text: "The homeownership rate here is 42.2%, so the majority of homes are not owner-occupied." },
  // Real output. A migration figure stated and then stopped, advice standing
  // on its own in the next sentence.
  {
    vertical: "moving-services",
    text: "Across Orange County, IRS returns recorded 52,675 households moving in and 56,502 moving out, for net household migration of -3,827. Get a written, itemized estimate from two or three companies.",
  },
  // Real output, from the site session's own integration: their supply-side
  // rule matched the bare word "book" inside "elevator-booking" and threw
  // away a correct page. A building's rule about its elevator says nothing
  // about how busy any company is.
  {
    vertical: "moving-services",
    text: "Homeownership here is 59.4%, so a substantial share of moves involve rental units; if that's you, confirm the mover can meet any certificate-of-insurance or elevator-booking requirements your building imposes.",
  },
  // Real output from the other trades, read and confirmed correct. Each one
  // uses its own trade's vocabulary heavily, which is exactly what an
  // over-broad off_trade rule would punish.
  {
    vertical: "roofing-replacement",
    text: "Get at least three itemized bids covering tear-off, underlayment, flashing and disposal, and verify each company's New Jersey home improvement contractor registration and liability and workers' comp coverage.",
  },
  {
    vertical: "hvac-repair",
    text: "Homes in ZIP 08701 have a median build year of 1993, so when you call, have the age, brand and model number of your furnace, air handler or condenser ready.",
  },
  {
    vertical: "water-damage-restoration",
    text: "Ask a restoration company how it documents moisture readings and drying logs day by day, since insurers will want that record.",
  },
  {
    vertical: "solar-installation",
    text: "Ask each installer to show the production estimate for your specific roof — orientation, pitch, and shading from trees or neighboring buildings all change the result.",
  },
];

/**
 * Fails loudly rather than reporting a reassuring zero from a dead regex.
 *
 * Three separate checks, because "the scanner works" means three things:
 * it catches known failures, it leaves known-good text alone, and — for a
 * scanner that serves 13 trades from one file — it never treats a trade's
 * own subject matter as off-topic.
 */
function assertScannerWorks(vertical: string): void {
  const patterns = patternsFor(vertical);

  // The two tables must cover the same trades. A trade with a brief but no
  // vocabulary here generates copy that nothing scans; a trade with
  // vocabulary but no brief can never generate. Both are silent.
  const briefs = new Set(VERTICALS_WITH_BRIEFS);
  const vocab = new Set(Object.keys(TRADE_VOCAB));
  const drift = [
    ...[...briefs].filter((v) => !vocab.has(v)).map((v) => `${v}: sinh được nhưng KHÔNG có ai quét`),
    ...[...vocab].filter((v) => !briefs.has(v)).map((v) => `${v}: quét được nhưng KHÔNG sinh được`),
  ];
  if (drift.length > 0) {
    console.error(`VERTICAL_BRIEFS và TRADE_VOCAB đã lệch nhau:`);
    for (const d of drift) console.error(`  ${d}`);
    process.exit(1);
  }

  // Structural: a trade's own vocabulary must never be off-trade FOR THAT
  // TRADE. Checked for every trade, not just the one being scanned, so the
  // guarantee cannot rot the next time a vocabulary is edited.
  const offTradeErrors: string[] = [];
  for (const [v, vocab] of Object.entries(TRADE_VOCAB)) {
    const offTrade = patternsFor(v).find((p) => p.name === "off_trade")!;
    for (const term of [...vocab.terms, ...vocab.providers]) {
      const sample = term.replace(/\\w\*/g, "ing").replace(/[?()|]|s\b/g, "");
      if (offTrade.test.test(sample)) offTradeErrors.push(`${v}: từ của chính nghề "${sample}" lại bị coi là lạc nghề`);
    }
  }
  if (offTradeErrors.length > 0) {
    console.error(`Bộ quét SAI CẤU TRÚC — từ vựng của một nghề bị tính là lạc nghề của chính nó:`);
    for (const e of offTradeErrors) console.error(`  ${e}`);
    process.exit(1);
  }

  // Fixtures are scoped to their trade. A moving-services sentence is
  // genuinely off-trade for a roofer, so running it under roofing's patterns
  // would report a false alarm that is really a category error in the test.
  const good = KNOWN_GOOD.filter((f) => f.vertical === vertical);
  const bad = KNOWN_BAD.filter((f) => f.vertical === vertical);

  const falseAlarms = good.flatMap((f) =>
    patterns.filter((p) => p.test.test(f.text)).map((p) => ({ text: f.text, pattern: p.name }))
  );
  if (falseAlarms.length > 0) {
    console.error(`Bộ quét BÁO NHẦM ${falseAlarms.length} câu ĐÚNG (lấy từ output thật) — thu regex lại trước khi dùng.`);
    console.error(`Luật quá rộng không kêu lên: nó lặng lẽ vứt bỏ văn tốt.`);
    for (const f of falseAlarms) console.error(`  [${f.pattern}] "${f.text.slice(0, 110)}…"`);
    process.exit(1);
  }

  const missed = bad.filter((f) => {
    const p = patterns.find((x) => x.name === f.pattern)!;
    return !p.test.test(f.text);
  });
  if (missed.length > 0) {
    console.error(`Bộ quét HỎNG: ${missed.length}/${bad.length} câu lỗi đã biết không bị bắt.`);
    console.error(`Kết quả "sạch" lúc này không chứng minh được gì. Sửa regex trước khi tin số liệu.`);
    for (const m of missed) console.error(`  [${m.pattern}] "${m.text}"`);
    process.exit(1);
  }

  console.log(
    `Tự kiểm (${vertical}): ${bad.length} câu lỗi đã biết đều bị bắt · ${good.length} câu đúng thật không bị báo nhầm · ` +
      `${Object.keys(TRADE_VOCAB).length} nghề không nghề nào lạc nghề với chính mình.`
  );

  // Coverage counted over PATTERNS, not over fixtures — they are different
  // sets and it is easy to mistake one for the other. "9 ca đều bị bắt" says
  // nothing about whether all four patterns were exercised: nine cases could
  // all hit the same pattern while three others have never been observed to
  // catch anything. The site session found five of its thirteen rules in
  // exactly that state while reporting a green suite.
  //
  // Reported per trade rather than enforced, because a trade whose fixture
  // set is still small is a REAL state of this project, not a bug — and
  // naming which patterns are unproven for it is more useful than either a
  // confident zero or a blocked run.
  const provenHere = new Set(
    patterns.filter((p) => bad.some((f) => f.pattern === p.name && p.test.test(f.text))).map((p) => p.name)
  );
  const provenAnywhere = new Set(
    patterns.filter((p) => KNOWN_BAD.some((f) => f.pattern === p.name && p.test.test(f.text))).map((p) => p.name)
  );
  const unproven = patterns
    .filter((p) => (p.verticalSpecific ? !provenHere.has(p.name) : !provenAnywhere.has(p.name)))
    .map((p) => p.name);
  if (unproven.length > 0) {
    console.log(
      `  ⚠️  Chưa có ca nào chứng minh các mẫu này BẮT ĐƯỢC cho "${vertical}": ${unproven.join(", ")}`
    );
    console.log(
      `      Số 0 của các mẫu đó bên dưới nghĩa là "chưa từng thấy nó bắt gì", không phải "đã kiểm và sạch". Đọc tay trước khi tin.`
    );
  }
  if (good.length === 0) {
    console.log(`  ⚠️  Chưa có câu ĐÚNG thật nào làm chuẩn cho "${vertical}" — chưa loại trừ được khả năng báo nhầm.`);
  }
  console.log();
}

/**
 * How many passages each pattern could actually reject.
 *
 * Coverage answers "has this pattern ever fired". This answers the different
 * question "can it fire HERE at all" — and a pattern can pass the first while
 * failing the second, which is the case fixtures cannot reach. A market with
 * no IRS data never receives a migration figure, so migration_bridge is inert
 * on it however the model writes; its zero belongs in a different column from
 * the zeros that mean "checked and clean".
 *
 * Reported, never enforced. A pattern with nothing to look at is a real state
 * of the data, not a defect, and failing the run over it would leave a
 * permanently red signal until somebody deleted the pattern to quiet it —
 * which is precisely how the thing it guards gets lost. A warning that is
 * always on is noise wearing the shape of a check.
 */
async function reportSurface(vertical: string, patterns: Pattern[]): Promise<void> {
  const zips = (
    await prisma.aiGeneration.findMany({
      where: { vertical, validationPassed: true },
      select: { zip: true },
      distinct: ["zip"],
    })
  ).map((r) => r.zip);
  if (zips.length === 0) return;

  console.log(`Bề mặt — mỗi mẫu có bao nhiêu đoạn để soi (trên ${zips.length} trang):`);
  for (const p of patterns) {
    if (p.requiresMetricPrefix === null) {
      console.log(`  ${p.name.padEnd(20)} ${String(zips.length).padStart(4)}  (áp dụng cho mọi đoạn văn)`);
      continue;
    }
    // Must go through the SAME vertical-filtered accessor the fact builder
    // uses, not a raw DataPoint query. A zip can hold IRS points collected
    // for moving-services while the solar FactSet never receives them — so
    // querying by zip alone reported a surface of 3 where the real one is 0,
    // measuring something adjacent to the question instead of the question.
    let n = 0;
    for (const zip of zips) {
      const points = await getRealDataPointsForZipAndVertical(zip, vertical);
      if (points.some((pt) => pt.metric.startsWith(p.requiresMetricPrefix!))) n++;
    }
    const mark = n === 0 ? "!" : " ";
    console.log(`${mark} ${p.name.padEnd(20)} ${String(n).padStart(4)}  (cần dữ liệu ${p.requiresMetricPrefix})`);
    if (n === 0) {
      console.log(
        `      Mẫu này KHÔNG THỂ kêu cho "${vertical}" — không trang nào có dữ liệu đó. Số 0 của nó nghĩa là "không có gì để soi".`
      );
    } else if (n < zips.length) {
      console.log(`      ${zips.length - n} trang không có dữ liệu đó, nên mẫu này không soi tới chúng.`);
    }
  }
  console.log();
}

async function main() {
  const vertical = process.argv[2];
  if (!vertical) {
    console.error("Cách dùng: tsx scripts/scan-generated-copy.ts <vertical>");
    process.exitCode = 1;
    return;
  }
  assertScannerWorks(vertical);
  const PATTERNS = patternsFor(vertical);
  await reportSurface(vertical, PATTERNS);

  const rows = await prisma.aiGeneration.findMany({
    where: { vertical, validationPassed: true },
    select: { zip: true, text: true },
    orderBy: { zip: "asc" },
  });

  console.log(`Quét ${rows.length} đoạn văn đã qua validator (ngành ${vertical})\n`);

  const hits = new Map<string, { zip: string; snippet: string }[]>();
  for (const p of PATTERNS) hits.set(p.name, []);

  for (const row of rows) {
    for (const p of PATTERNS) {
      const m = p.test.exec(row.text);
      if (!m) continue;
      // Show the whole sentence, not the match: "roofing" alone tells you
      // nothing about whether the sentence is actually off-trade.
      const sentence =
        row.text.split(/(?<=[.!?])\s+/).find((s) => p.test.test(s))?.trim() ?? m[0];
      hits.get(p.name)!.push({ zip: row.zip, snippet: sentence.slice(0, 160) });
    }
  }

  let totalFlagged = 0;
  for (const p of PATTERNS) {
    const found = hits.get(p.name)!;
    totalFlagged += found.length;
    const pct = rows.length === 0 ? 0 : (found.length / rows.length) * 100;
    console.log(`### ${p.name}: ${found.length}/${rows.length} (${pct.toFixed(1)}%)`);
    console.log(`    ${p.why}`);
    for (const f of found.slice(0, 8)) console.log(`    ${f.zip}: "${f.snippet}"`);
    if (found.length > 8) console.log(`    … và ${found.length - 8} đoạn nữa`);
    console.log();
  }

  const clean = rows.filter((r) => !PATTERNS.some((p) => p.test.test(r.text))).length;
  console.log(`=== ${clean}/${rows.length} đoạn sạch cả 4 mẫu lỗi; ${totalFlagged} lần khớp ===`);
  // Every hit is a candidate, not a verdict: these are regexes, and a
  // sentence has to be read to know whether it is actually wrong. Exit
  // non-zero so a CI run stops rather than treating a flag as noise.
  if (totalFlagged > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    // A missing TRADE_VOCAB entry is a expected, actionable refusal, not a
    // crash — print what to do, not a stack trace.
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
