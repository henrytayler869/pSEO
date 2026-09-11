// Proves every QC check can FAIL.
//
// The assertion is not "a good article passes" — that shape of test goes green
// whether or not the check is wired to anything. Each case below breaks ONE
// thing and asserts that exactly the check owning it fails.
//
// The bad case comes first in each pair on purpose: writing the passing case
// first is how a check that never fires gets a green suite.
//
// Usage: tsx scripts/test-article-qc.ts

import { runQc, type ArticleDraft, type QcContext } from "../lib/article-qc/checklist";
import type { FactSet } from "../lib/ai/facts";

const FACTS: FactSet = {
  vertical: "moving-services",
  zip: "00000",
  city: "Testville",
  state: "FL",
  county: "Orange County",
  mainKeyword: null,
  countyKeyword: null,
  fingerprint: "qc-test",
  facts: [
    {
      key: "inflow",
      label: "households moving in",
      value: 52675,
      display: "52,675 households",
      unit: "households/yr",
      scope: "COUNTY",
      scopeName: "Orange County",
    },
    {
      key: "outflow",
      label: "households moving out",
      value: 56502,
      display: "56,502 households",
      unit: "households/yr",
      scope: "COUNTY",
      scopeName: "Orange County",
    },
  ],
};

const CTX: QcContext = {
  factSet: FACTS,
  semanticKeywords: ["moving services near me", "moving help", "moving services prices"],
  reservedTerms: [{ term: "local moving services", ownedBy: "/local-moving" }],
  knownPaths: new Set(["/local-moving", "/long-distance-moving", "/moving-services"]),
  existingTitles: ["Moving to FL? The 5 counties taking in the most people"],
};

const BODY_WORDS = "Planning the move takes more preparation than most people expect and the details matter. ".repeat(
  40
);

/** A draft that passes everything. Each case below breaks exactly one part. */
function goodDraft(): ArticleDraft {
  return {
    title: "Orange County household moves: what the IRS data shows",
    metaDescription:
      "IRS county migration figures for Orange County, with what they do and do not tell you when you are planning a move.",
    html:
      `<p>IRS records show 52,675 households moved in across Orange County, and 56,502 moved out. ` +
      `${BODY_WORDS}</p>` +
      `<h2>What the figures cover</h2><p>${BODY_WORDS}</p>` +
      `<h2>When you ask for quotes</h2><p>Compare moving services prices and use ` +
      `<a href="/local-moving">local moving services</a> or ` +
      `<a href="/long-distance-moving">longer routes</a>. Search moving help early. ${BODY_WORDS}</p>`,
  };
}

interface Case {
  name: string;
  /** Check that MUST fail. null when the draft should pass everything. */
  expectFail: string | null;
  draft: () => ArticleDraft;
  ctx?: Partial<QcContext>;
}

const CASES: Case[] = [
  {
    name: "con số không có trong fact set -> facts-verified",
    expectFail: "facts-verified",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace("52,675 households", "61,900 households");
      return d;
    },
  },
  {
    name: "treo nhận định về hãng lên số liệu -> no-supply-side-claim",
    expectFail: "no-supply-side-claim",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace(
        "<h2>What the figures cover</h2>",
        "<p>The balance is 52,675 households a year, so demand splits toward local crews and hourly rates.</p><h2>What the figures cover</h2>"
      );
      return d;
    },
  },
  {
    name: "chỉ 1 từ khoá ngữ nghĩa -> semantic-coverage",
    expectFail: "semantic-coverage",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace("Compare moving services prices and use", "Compare options and use").replace("Search moving help early.", "");
      return d;
    },
  },
  {
    name: "link nội bộ trỏ vào trang KHÔNG tồn tại -> internal-links",
    expectFail: "internal-links",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace('href="/long-distance-moving"', 'href="/khong-ton-tai"');
      return d;
    },
  },
  {
    name: "không có link nội bộ nào -> internal-links",
    expectFail: "internal-links",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
      return d;
    },
  },
  {
    name: "term dành riêng neo sang trang khác -> reserved-term-anchors",
    expectFail: "reserved-term-anchors",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace('<a href="/local-moving">local moving services</a>', '<a href="/moving-services">local moving services</a>');
      return d;
    },
  },
  {
    name: "tiêu đề quá dài -> title-length",
    expectFail: "title-length",
    draft: () => ({ ...goodDraft(), title: "Orange County household moves and everything else the federal migration records happen to show this year" }),
  },
  {
    name: "meta description quá ngắn -> meta-description",
    expectFail: "meta-description",
    draft: () => ({ ...goodDraft(), metaDescription: "Too short." }),
  },
  {
    name: "bài quá ngắn -> min-words",
    expectFail: "min-words",
    draft: () => ({
      ...goodDraft(),
      html: `<p>IRS records show 52,675 households moved in.</p><h2>A</h2><p>x</p><h2>B</h2><p><a href="/local-moving">local moving services</a> moving help moving services prices</p>`,
    }),
  },
  {
    name: "chỉ 1 thẻ H2 -> heading-structure",
    expectFail: "heading-structure",
    draft: () => {
      const d = goodDraft();
      d.html = d.html.replace("<h2>When you ask for quotes</h2>", "<h3>When you ask for quotes</h3>");
      return d;
    },
  },
  {
    name: "tiêu đề trùng bài đã có -> not-duplicate-title",
    expectFail: "not-duplicate-title",
    draft: () => ({ ...goodDraft(), title: "Moving to FL? The 5 counties taking in the most people" }),
  },
  {
    name: "bài tốt -> KHÔNG mục nào trượt",
    expectFail: null,
    draft: goodDraft,
  },
];

let ok = 0;
const failures: string[] = [];
const firedAtLeastOnce = new Set<string>();

for (const c of CASES) {
  const report = runQc(c.draft(), { ...CTX, ...c.ctx });
  const failed = report.checks.filter((x) => !x.passed).map((x) => x.id);
  for (const f of failed) firedAtLeastOnce.add(f);

  const good =
    c.expectFail === null
      ? failed.length === 0
      : failed.includes(c.expectFail);

  if (good) ok++;
  else
    failures.push(
      `${c.name}\n      trượt: [${failed.join(", ") || "không mục nào"}], kỳ vọng ${c.expectFail ?? "không mục nào"}`
    );
  console.log(`${good ? "✓" : "✗"} ${c.name}`);
}

// Every check must have fired at least once across the suite. A check that
// never failed anywhere is a check this suite does not actually test — the
// exact hole that mutation testing found in the validator.
const allIds = runQc(goodDraft(), CTX).checks.map((c) => c.id);
const never = allIds.filter((id) => !firedAtLeastOnce.has(id));
console.log();
if (never.length === 0) {
  ok++;
  console.log(`✓ độ phủ: cả ${allIds.length} mục đều có ca làm nó trượt`);
} else {
  failures.push(`các mục CHƯA ca nào làm trượt: ${never.join(", ")}`);
  console.log(`✗ độ phủ: ${never.join(", ")} chưa ca nào làm trượt`);
}

console.log(`\n${ok}/${CASES.length + 1} kiểm tra đúng.`);
if (failures.length > 0) {
  console.error(`\nTHẤT BẠI:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
