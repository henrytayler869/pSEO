// Test suite for the anti-fabrication validator (lib/ai/validate.ts).
//
// This validator is the only thing standing between "the page states a
// measured figure" and "the page states a number nobody measured", so it is
// the one piece here that gets asserted rather than trusted. It runs against
// a REAL FactSet built from this app's live data, not fixtures — a rule that
// passes on hand-written facts but not on the shapes the collectors actually
// produce is not a rule that protects anything.
//
// Several cases below are not hypothetical. "one resident in five" is a
// sentence that a consuming site generated and very nearly published, beside
// a measured 29.5%. It is here so that specific failure can never return.
//
// Usage: tsx scripts/test-ai-validator.ts

import { prisma } from "../lib/db/prisma";
import { buildFactSet, type FactSet } from "../lib/ai/facts";
import { validateGeneratedText } from "../lib/ai/validate";

/** Every rule validateGeneratedText can raise.
 *
 * Listed explicitly so the suite can check TEST CASES against RULES — two
 * different sets that are easy to mistake for one. Counting cases and
 * reporting "20/20 passing" says nothing about whether all four rules were
 * exercised; a rule with no case that trips it has never been observed to
 * protect anything, and its silence in production is not evidence.
 *
 * The site session found five of its thirteen rules in exactly that state
 * while reporting a green suite. Same trap, one table over. */
const RULES = ["unsupported_number", "scope_overclaim", "worded_proportion", "invented_place_name"];

interface Case {
  name: string;
  text: (f: FactSet) => string;
  shouldPass: boolean;
  /** Some rules only apply to a market with a particular data shape (e.g.
   * a missing county name), so those cases validate against that market's
   * real FactSet instead of the default one. */
  zipOverride?: string;
}

const CASES: Case[] = [
  // --- figures that are real and correctly scoped ---
  {
    name: "ZIP-level figure, stated plainly",
    text: (f) => `Homes here carry a median value of $${zipFact(f, "census_median_home_value_usd").toLocaleString()}.`,
    shouldPass: true,
  },
  {
    // Trích ĐÚNG chuỗi prompt in ra, không tự định dạng lại. Đó chính là hợp
    // đồng mới: model được phép dùng giá trị đo hoặc giá trị prompt đã in,
    // không có gì ở giữa.
    name: "measured percentage, quoted exactly as the prompt printed it",
    text: (f) => `${displayOf(f, "census_mobility_rate_pct")} of residents lived elsewhere a year ago.`,
    shouldPass: true,
  },
  {
    // REGRESSION cho một khác biệt ĐÃ CÀI SẴN giữa hai validator. Site đã
    // xuất bản chỉ chấp nhận các mức làm tròn ĐƯỢC HIỂN THỊ; dung sai 0.5%
    // cũ ở đây chấp nhận thêm một vùng quanh đó. Một đoạn văn rơi vào vùng
    // ấy sẽ qua được HQ, tốn tiền sinh, vào cache — rồi bị site bỏ, để lại
    // một trang thiếu phần diễn giải mà không lỗi nào nối hai việc đó lại.
    name: "REGRESSION: model tự làm tròn LẦN NỮA -> từ chối",
    text: (f) =>
      `Median home value sits near $${(Math.round(zipFact(f, "census_median_home_value_usd") / 1000) * 1000).toLocaleString()}.`,
    shouldPass: false,
  },
  {
    name: "giá trị đo nguyên vẹn vẫn được chấp nhận",
    text: (f) => `Median home value sits at $${zipFact(f, "census_median_home_value_usd").toLocaleString()}.`,
    shouldPass: true,
  },
  {
    name: "county figure with the county named",
    text: (f) => {
      const fact = f.facts.find((x) => x.key === "irs_migration_inflow_households")!;
      return `Across ${fact.scopeName}, ${fact.value.toLocaleString()} households moved in.`;
    },
    shouldPass: true,
  },
  { name: "the zip itself is an identifier, not a claim", text: () => `Movers serving ZIP 10002 quote by the hour.`, shouldPass: true },
  { name: "a year is not a quantity", text: () => `Most homes here went up before 1960.`, shouldPass: true },

  // --- negative figures (net migration is genuinely negative in many counties) ---
  {
    name: "REGRESSION: negative county figure, written with the minus sign",
    text: (f) => {
      const fact = f.facts.find((x) => x.key === "irs_migration_net_households");
      if (!fact) throw new Error("cần irs_migration_net_households");
      return `${fact.scopeName} recorded net migration of ${fact.value.toLocaleString()} households.`;
    },
    shouldPass: true,
  },
  {
    name: "negative figure written as a loss in words",
    text: (f) => {
      const fact = f.facts.find((x) => x.key === "irs_migration_net_households");
      if (!fact) throw new Error("cần irs_migration_net_households");
      return `${fact.scopeName} saw a net loss of ${Math.abs(fact.value).toLocaleString()} households.`;
    },
    shouldPass: true,
  },

  // --- fabricated figures ---
  { name: "invented dollar figure", text: () => `A typical local move runs about $4,275.`, shouldPass: false },
  { name: "invented count", text: () => `Some 1,847 families relocate here each year.`, shouldPass: false },

  // --- real figure, false scope ---
  {
    name: "county figure claimed for the zip",
    text: (f) => {
      const fact = f.facts.find((x) => x.key === "irs_migration_inflow_households")!;
      return `In ZIP ${f.zip}, ${fact.value.toLocaleString()} households moved in last year.`;
    },
    shouldPass: false,
  },

  // --- proportions written as words (the real shipped bug) ---
  {
    name: "REGRESSION: 'one resident in five' (shipped, nearly published)",
    text: () => `That is high turnover: roughly one resident in five changed address.`,
    shouldPass: false,
  },
  { name: "'one in five', adjacent", text: () => `About one in five moved last year.`, shouldPass: false },
  { name: "'two out of three'", text: () => `Two out of three moves stay local.`, shouldPass: false },
  { name: "'a third of'", text: () => `A third of households here are owner-occupied.`, shouldPass: false },
  { name: "'half of'", text: () => `Half of the moves start outside the county.`, shouldPass: false },

  // --- county equivalents that are not called "County" ---
  // A rule that only knows the word "county" lets an invented "Orleans
  // Parish" through in exactly the case where the model most wants to
  // supply a name. Three real examples already in this dataset don't
  // contain the word: District of Columbia, Norfolk city, Virginia Beach city.
  {
    name: "REGRESSION: invented 'Parish' when the dataset has no county name",
    text: () => `Orleans Parish saw strong inflows last year.`,
    shouldPass: false,
    zipOverride: "06902", // Connecticut Planning Region — genuinely has no county name
  },
  {
    name: "no county name available: the required fallback wording",
    text: () => `Across the county containing ZIP 06902, moves are steady.`,
    shouldPass: true,
    zipOverride: "06902",
  },

  // --- ordinary prose that merely looks like a proportion ---
  { name: "not a proportion: 'one thing to check in three minutes'", text: () => `There is one thing to check in three minutes.`, shouldPass: true },
  { name: "not a proportion: 'one of the best'", text: () => `This is one of the best neighbourhoods for movers.`, shouldPass: true },
];

/** Chuỗi mà prompt THẬT SỰ in ra cho fact này — mốc duy nhất mà validator
 * chấp nhận, ngoài giá trị đo gốc. */
function displayOf(f: FactSet, key: string): string {
  const fact = f.facts.find((x) => x.key === key);
  if (!fact) throw new Error(`Dữ liệu thật thiếu chỉ số "${key}" — test cần nó, hãy chạy thu thập trước.`);
  return fact.display;
}

function zipFact(f: FactSet, key: string): number {
  const fact = f.facts.find((x) => x.key === key);
  if (!fact) throw new Error(`Dữ liệu thật thiếu chỉ số "${key}" — test cần nó, hãy chạy thu thập trước.`);
  return fact.value;
}

async function main() {
  const vertical = "moving-services";
  const zip = "10002";
  const factSet = await buildFactSet(vertical, zip);
  if (!factSet) {
    console.error(`Không dựng được FactSet cho ${vertical}/${zip} — cần dữ liệu thật trước khi test validator.`);
    process.exitCode = 1;
    return;
  }

  console.log(`FactSet thật: ${factSet.facts.length} chỉ số cho ${vertical}/${zip} (county=${factSet.county})\n`);

  let passed = 0;
  const failures: string[] = [];
  const rulesTriggered = new Set<string>();
  for (const c of CASES) {
    const fs = c.zipOverride ? await buildFactSet(vertical, c.zipOverride) : factSet;
    if (!fs) {
      console.log(`— bỏ qua "${c.name}": không dựng được FactSet cho ${c.zipOverride}`);
      continue;
    }
    const text = c.text(fs);
    const result = validateGeneratedText(text, fs);
    for (const i of result.issues) rulesTriggered.add(i.rule);
    const ok = result.passed === c.shouldPass;
    if (ok) passed++;
    else failures.push(c.name);
    console.log(`${ok ? "✓" : "✗"} ${c.name}`);
    if (!ok) {
      console.log(`    text : ${text}`);
      console.log(`    được : ${result.passed ? "ĐẠT" : "CHẶN"}, kỳ vọng ${c.shouldPass ? "ĐẠT" : "CHẶN"}`);
      for (const i of result.issues) console.log(`    [${i.rule}] ${i.detail}`);
    }
  }

  console.log(`\n${passed}/${CASES.length} test đúng.`);
  if (failures.length > 0) {
    console.error(`THẤT BẠI: ${failures.join(", ")}`);
    process.exitCode = 1;
  }

  // Coverage over RULES, not over cases. A green suite that never trips a
  // rule leaves that rule unobserved, and an unobserved rule's silence in
  // production means nothing.
  const neverTriggered = RULES.filter((r) => !rulesTriggered.has(r));
  if (neverTriggered.length > 0) {
    console.error(`\nĐỘ PHỦ LUẬT THIẾU — không ca nào làm các luật này kêu: ${neverTriggered.join(", ")}`);
    console.error(`Luật chưa từng được quan sát là chặn được gì thì lúc nó im cũng không nói lên điều gì.`);
    process.exitCode = 1;
  } else {
    console.log(`Độ phủ: cả ${RULES.length} luật đều có ca làm nó kêu.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
