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
import { buildFactSet } from "../lib/ai/facts";

import { patternsFor, TRADE_VOCAB, type Pattern } from "../lib/content-rules/copy-patterns";

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
    // Counted from the FACTS the model actually receives, not from
    // DataPoints.
    //
    // Two hops matter and only the second is definitional. Querying
    // DataPoint by zip was wrong outright — a zip holds IRS points collected
    // for moving-services that the solar FactSet never receives, so it
    // reported a surface of 3 where the real one is 0. Going through the
    // vertical-filtered accessor fixed that, but it agreed with the fact
    // builder by coincidence of using the same call, not by construction:
    // facts.ts already drops one input on purpose (search volume), so the
    // DataPoint -> Fact mapping is not 1:1 and nothing keeps it that way.
    // Any further filter added there would leave this over-reporting a reach
    // the model never had.
    //
    // Reading buildFactSet closes that: a pattern's surface IS the set of
    // prompts carrying the figure it looks for, and buildFactSet is the
    // definition of what a prompt carries. It cannot drift from the thing it
    // measures.
    let n = 0;
    for (const zip of zips) {
      const factSet = await buildFactSet(vertical, zip);
      if (factSet?.facts.some((f) => f.key.startsWith(p.requiresMetricPrefix!))) n++;
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
