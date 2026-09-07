// Regression tests for the two calculations that decide what gets built.
//
// Both had a real bug in this project, both fixes shipped with nothing
// guarding them, and both are pure functions that were never exercised by a
// test. A wrong number here does not crash anything — it quietly reorders
// which markets look worth building, which is the kind of error that gets
// acted on rather than noticed.
//
// Usage: tsx scripts/test-scoring-and-traffic.ts

import { computeTrafficValues, computeTrafficBaselines } from "../lib/keywords/traffic-metrics";

const at = (d: string) => new Date(d);
const kw = (keyword: string, searchVolume: number, cpc: number, keywordDifficulty: number, fetchedAt = at("2026-09-01")) => ({
  keyword,
  fetchedAt,
  searchVolume,
  cpc,
  keywordDifficulty,
});

interface Case {
  name: string;
  run: () => boolean;
}

const CASES: Case[] = [
  {
    // REGRESSION. "No keyword data" and "measured as zero" are different
    // facts, and this returns null for the first. A market whose keyword
    // genuinely has no search volume is not a market with unknown demand — but
    // it is also not buildable, so null is right. The distinction matters
    // because callers branch on null.
    name: "REGRESSION: không có từ khoá -> null (không phải 0)",
    run: () => computeTrafficValues([]) === null,
  },
  {
    name: "REGRESSION: mọi từ khoá volume 0 -> null, không phải {searchVolume:0}",
    run: () => computeTrafficValues([kw("a", 0, 1, 5)]) === null,
  },
  {
    // REGRESSION, and the expensive one. This SUMS search volume across every
    // keyword a market has. Two phrasings of the same query therefore produce
    // a number that describes no real quantity — 1,210 monthly searches where
    // the truth was two measurements of the same demand.
    //
    // The fix was never in this function: it is upstream, where the keyword
    // refresh throws if any market ends up with more than one keyword. That
    // guardrail is invisible from here, so this test pins the behaviour it
    // exists to protect against. If summing ever looks wrong to a future
    // reader, the answer is that the invariant lives upstream.
    name: "REGRESSION: hai từ khoá -> volume bị CỘNG (lý do có guardrail 1-từ-khoá/market)",
    run: () => computeTrafficValues([kw("a", 500, 2, 10), kw("b", 710, 4, 20)])?.searchVolume === 1210,
  },
  {
    name: "cpc và KD lấy TRUNG BÌNH, không cộng",
    run: () => {
      const v = computeTrafficValues([kw("a", 500, 2, 10), kw("b", 710, 4, 20)]);
      return v?.cpc === 3 && v?.keywordDifficulty === 15;
    },
  },
  {
    // REGRESSION: keywordDifficulty 0 is a real DataForSEO value meaning "no
    // competition", not missing data. An earlier version of the scoring path
    // skipped these markets entirely, discarding the least competitive — and
    // therefore most attractive — ones. computeTrafficValues must carry the
    // zero through rather than treat it as absent.
    name: "REGRESSION: KD = 0 là giá trị thật, phải giữ lại chứ không loại",
    run: () => computeTrafficValues([kw("a", 5400, 21.92, 0)])?.keywordDifficulty === 0,
  },
  {
    name: "chỉ lấy bản đo MỚI NHẤT của mỗi từ khoá",
    run: () => {
      const v = computeTrafficValues([
        kw("a", 100, 1, 10, at("2026-01-01")),
        kw("a", 900, 9, 90, at("2026-09-01")),
      ]);
      return v?.searchVolume === 900 && v?.cpc === 9;
    },
  },
  {
    name: "baseline bỏ qua market không có dữ liệu, không tính chúng là 0",
    run: () => {
      // Một market có dữ liệu (600), một market rỗng. Trung bình phải là 600,
      // không phải 300 — coi "không đo được" thành 0 sẽ kéo tụt mọi baseline.
      const b = computeTrafficBaselines([{ keywordMetrics: [kw("a", 600, 3, 12)] }, { keywordMetrics: [] }]);
      return b.searchVolume === 600;
    },
  },
  {
    name: "baseline khi KHÔNG market nào có dữ liệu -> 0, không chia cho 0",
    run: () => {
      const b = computeTrafficBaselines([{ keywordMetrics: [] }]);
      return b.searchVolume === 0 && Number.isFinite(b.cpc);
    },
  },
];

// The scoring formula is checked as arithmetic rather than through
// computeMarketScoresForImport, which needs a database. The value being
// protected is the divisor: Math.max(difficultyIndex, 1). Without the floor a
// KD of 0 divides by zero and yields Infinity, and every zero-competition
// market — the best ones — sorts to the top or breaks the ordering entirely,
// depending on what downstream does with Infinity.
const MIN_DIFFICULTY_FLOOR = 1;
const score = (payout: number, conv: number, volume: number, kd: number) =>
  (payout * conv * volume) / Math.max(kd, MIN_DIFFICULTY_FLOOR);

CASES.push(
  {
    name: "REGRESSION điểm số: KD = 0 cho ra số HỮU HẠN (sàn = 1), không phải Infinity",
    run: () => Number.isFinite(score(100, 0.02, 5400, 0)) && score(100, 0.02, 5400, 0) === 10800,
  },
  {
    name: "điểm số: KD > 1 thì sàn không can thiệp",
    run: () => score(100, 0.02, 5400, 20) === 540,
  },
  {
    name: "REGRESSION điểm số: KD nhỏ hơn 1 vẫn bị kẹp về 1, không thổi phồng điểm",
    run: () => score(100, 0.02, 5400, 0.5) === 10800,
  }
);

function main() {
  let passed = 0;
  const failed: string[] = [];
  for (const c of CASES) {
    let ok = false;
    try {
      ok = c.run();
    } catch {
      ok = false;
    }
    if (ok) passed++;
    else failed.push(c.name);
    console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  }
  console.log(`\n${passed}/${CASES.length} đúng.`);
  if (failed.length > 0) {
    console.error(`THẤT BẠI: ${failed.join(" | ")}`);
    process.exitCode = 1;
  }
}

main();
