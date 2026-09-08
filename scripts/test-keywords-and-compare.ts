// Tests for the two modules that had none.
//
// Both are pure logic sitting on a hot path, and both fail quietly. The
// keyword functions decide which phrasing a market is scored on — get it wrong
// and the market ranking shifts with no error anywhere. The comparison functions
// decide whether a collection run looks like a change worth reading, and their
// whole substance is edge cases: a metric that appears or vanishes between
// snapshots, a previous value of zero, an average taken over a location set
// that moved underneath it.
//
// Usage: tsx scripts/test-keywords-and-compare.ts

import { applyStateSuffix, renderTemplate, pickBestCandidate } from "../lib/keywords/patterns";
import { computeMetricDeltas, formatPercentChange } from "../lib/collector/compare";

interface Case {
  name: string;
  expect: string;
  run: () => string;
}

const pt = (locationId: string, metric: string, value: number, unit = "u") => ({ locationId, metric, value, unit });
const delta = (metric: string, current: ReturnType<typeof pt>[], previous: ReturnType<typeof pt>[]) => {
  const d = computeMetricDeltas(current, previous).find((m) => m.metric === metric);
  if (!d) return "KHÔNG CÓ";
  return `n=${d.sampleSize} trước=${d.previousAvg} sau=${d.currentAvg} đổi=${d.percentChange} đáng_kể=${d.significantChangeCount}`;
};

const CASES: Case[] = [
  // --- applyStateSuffix ---
  {
    name: "hậu tố bang: thêm cho thành phố trùng tên, đúng bang cần",
    // Giữ nguyên hoa thường của place, chỉ bang được viết thường — place đi
    // thẳng vào từ khoá hiển thị, còn bang chỉ là hậu tố.
    expect: "Springfield il",
    run: () => applyStateSuffix("Springfield", "IL", { springfield: ["IL", "MO"] }),
  },
  {
    // The measurement decided per (city, state) pair, not per city. A city
    // needing the suffix in one state must not gain it in another.
    name: "hậu tố bang: KHÔNG thêm cho bang không nằm trong danh sách",
    expect: "Springfield",
    run: () => applyStateSuffix("Springfield", "OR", { springfield: ["IL", "MO"] }),
  },
  {
    name: "hậu tố bang: không có trong danh sách -> giữ nguyên",
    expect: "Tulsa",
    run: () => applyStateSuffix("Tulsa", "OK", { springfield: ["IL"] }),
  },
  {
    // The lookup key is lowercased and the state uppercased on both sides.
    // Case coming from a CSV must not silently miss.
    name: "hậu tố bang: khớp bất kể hoa thường ở đầu vào",
    expect: "SPRINGFIELD il",
    run: () => applyStateSuffix("SPRINGFIELD", "il", { springfield: ["IL"] }),
  },

  // --- renderTemplate ---
  {
    name: "template: thay cả {vertical} và {place}",
    expect: "moving services austin",
    run: () => renderTemplate("{vertical} {place}", "moving-services", "austin"),
  },
  {
    // REGRESSION: the vertical arrives as a slug. A hyphen left in place
    // produces "moving-services austin", which is not a phrase anyone types.
    name: "REGRESSION template: dấu gạch ngang trong vertical thành khoảng trắng",
    expect: "solar panel installation dallas",
    run: () => renderTemplate("{vertical} {place}", "solar-panel-installation", "dallas"),
  },
  {
    name: "template: thay TẤT CẢ lần xuất hiện, không chỉ lần đầu",
    expect: "austin movers in austin",
    run: () => renderTemplate("{place} movers in {place}", "moving-services", "austin"),
  },
  {
    name: "template: cắt khoảng trắng thừa hai đầu",
    expect: "roofing miami",
    run: () => renderTemplate("  {vertical} {place}  ", "roofing", "miami"),
  },

  // --- pickBestCandidate ---
  {
    name: "chọn từ khoá: volume cao nhất thắng",
    expect: "b",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 100, cpc: 1, keywordDifficulty: 1 },
      { keyword: "b", searchVolume: 900, cpc: 1, keywordDifficulty: 90 },
    ])!.keyword,
  },
  {
    // A genuine tie means the engine treats them as the same query, so the
    // one that is easier to rank for is strictly better.
    name: "chọn từ khoá: volume bằng nhau -> KD thấp hơn thắng",
    expect: "b",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 500, cpc: 1, keywordDifficulty: 40 },
      { keyword: "b", searchVolume: 500, cpc: 1, keywordDifficulty: 12 },
    ])!.keyword,
  },
  {
    // Determinism matters more than which one wins: the pipeline re-runs, and
    // a choice that flips between runs rewrites market scores for no reason.
    name: "chọn từ khoá: bằng nhau hoàn toàn -> giữ thứ tự template, có thể lặp lại",
    expect: "a",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 500, cpc: 1, keywordDifficulty: 20 },
      { keyword: "b", searchVolume: 500, cpc: 9, keywordDifficulty: 20 },
    ])!.keyword,
  },
  {
    name: "chọn từ khoá: KD = 0 là giá trị thật, phải thắng KD 20",
    expect: "b",
    run: () => pickBestCandidate([
      { keyword: "a", searchVolume: 500, cpc: 1, keywordDifficulty: 20 },
      { keyword: "b", searchVolume: 500, cpc: 1, keywordDifficulty: 0 },
    ])!.keyword,
  },
  {
    name: "chọn từ khoá: danh sách rỗng -> null, không phải ném lỗi",
    expect: "null",
    run: () => String(pickBestCandidate([])),
  },

  // --- computeMetricDeltas ---
  {
    name: "so sánh: trung bình và phần trăm trên tập địa điểm chung",
    expect: "n=2 trước=100 sau=110 đổi=10 đáng_kể=2",
    run: () =>
      delta(
        "m",
        [pt("A", "m", 110), pt("B", "m", 110)],
        [pt("A", "m", 100), pt("B", "m", 100)]
      ),
  },
  {
    // REGRESSION: a location present in only one snapshot must not enter the
    // average. Otherwise a source that gained coverage reports a "change" that
    // is really a change of denominator — which is exactly what NOAA did when
    // it went from 272 to 293 locations.
    name: "REGRESSION so sánh: địa điểm chỉ có ở MỘT phía bị loại khỏi trung bình",
    expect: "n=1 trước=100 sau=100 đổi=0 đáng_kể=0",
    run: () =>
      delta(
        "m",
        [pt("A", "m", 100), pt("MỚI", "m", 9999)],
        [pt("A", "m", 100), pt("CŨ", "m", -9999)]
      ),
  },
  {
    // REGRESSION, documented in the source: zero-to-nonzero used to compute as
    // 0% and never count as significant — hiding precisely the event this
    // comparison exists to surface (a county's first FEMA declaration).
    name: "REGRESSION so sánh: 0 -> khác 0 là ĐÁNG KỂ, không phải 0%",
    expect: "n=1 trước=0 sau=3 đổi=null đáng_kể=1",
    run: () => delta("m", [pt("A", "m", 3)], [pt("A", "m", 0)]),
  },
  {
    name: "so sánh: 0 -> 0 là 0%, không đáng kể, không phải null",
    expect: "n=1 trước=0 sau=0 đổi=0 đáng_kể=0",
    run: () => delta("m", [pt("A", "m", 0)], [pt("A", "m", 0)]),
  },
  {
    name: "so sánh: không có địa điểm chung -> bỏ hẳn chỉ số, không chia cho 0",
    expect: "KHÔNG CÓ",
    run: () => delta("m", [pt("A", "m", 5)], [pt("B", "m", 5)]),
  },
  {
    name: "so sánh: chỉ số chỉ có ở bản mới -> không có delta giả",
    expect: "KHÔNG CÓ",
    run: () => delta("mới", [pt("A", "mới", 5)], [pt("A", "cũ", 5)]),
  },
  {
    // Ngưỡng thật là 10% và so sánh là >=, nên 10,0 KÊU còn 9,9 IM. Kẹp sát
    // hai bên ngưỡng: một ngưỡng chỉ chứng minh được ở một phía thì không
    // chứng minh được gì — nó im với mọi thứ hoặc kêu với mọi thứ cũng vậy.
    name: "so sánh: đổi 9,9% -> IM (ngay dưới ngưỡng)",
    expect: "0",
    run: () => String(computeMetricDeltas([pt("A", "m", 109.9)], [pt("A", "m", 100)])[0].significantChangeCount),
  },
  {
    name: "so sánh: đổi đúng 10,0% -> KÊU (ngưỡng là >=)",
    expect: "1",
    run: () => String(computeMetricDeltas([pt("A", "m", 110)], [pt("A", "m", 100)])[0].significantChangeCount),
  },
  {
    name: "so sánh: GIẢM 12% cũng đáng kể, không chỉ tăng",
    expect: "1",
    run: () => String(computeMetricDeltas([pt("A", "m", 88)], [pt("A", "m", 100)])[0].significantChangeCount),
  },

  // --- formatPercentChange ---
  {
    name: "định dạng: null hiển thị là 'từ 0', không phải 0%",
    expect: "N/A (từ 0)",
    run: () => formatPercentChange(null),
  },
  {
    name: "định dạng: số dương có dấu +",
    expect: "+12.3%",
    run: () => formatPercentChange(12.34),
  },
  {
    name: "định dạng: số âm giữ dấu -, không thêm +",
    expect: "-8.0%",
    run: () => formatPercentChange(-7.95),
  },
  {
    name: "định dạng: đúng 0 hiển thị +0.0%, không phải null",
    expect: "+0.0%",
    run: () => formatPercentChange(0),
  },
];

function main() {
  let passed = 0;
  const failures: string[] = [];
  for (const c of CASES) {
    let got: string;
    try {
      got = c.run();
    } catch (err) {
      got = `ném lỗi: ${err instanceof Error ? err.message : String(err)}`;
    }
    const ok = got === c.expect;
    if (ok) passed++;
    else failures.push(`${c.name}\n    mong đợi: ${c.expect}\n    nhận được: ${got}`);
    console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  }
  console.log();
  if (failures.length > 0) {
    console.log(`${passed}/${CASES.length} test đúng. Hỏng:\n`);
    for (const f of failures) console.log(`  ${f}\n`);
    process.exitCode = 1;
  } else {
    console.log(`${passed}/${CASES.length} test đúng.`);
  }
}

main();
