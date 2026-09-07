// Proves the collector's validation rules can actually FIRE — and stay quiet
// on clean input.
//
// Why this exists: on this app's real collected data, two of the four rules
// have never produced a single flag. `stale_data` and `cross_source_deviation`
// have fired zero times, ever. That is consistent with "the data has been
// fine", and equally consistent with "the rule is dead" — and a batch gate
// that cannot fire looks exactly like a batch gate over clean data. Every OK
// snapshot this app has approved rests on the assumption that these rules
// would have objected, and until now nothing tested that assumption.
//
// checkCrossSource matters most here. It was edited during this project to
// stop skipping zero-valued baselines (`|| other.value === 0) continue`
// dropped precisely the disagreements the rule exists to catch), and that fix
// shipped without ever being observed to flag anything. A fix to a rule that
// has never fired is a fix nobody has seen work.
//
// Each case states what it is proving. Cases marked REGRESSION encode a bug
// that was actually present in this file's history.
//
// Usage: tsx scripts/test-validation-rules.ts

import {
  checkCompleteness,
  checkOutliers,
  checkFreshness,
  checkCrossSource,
  type LocationPoint,
} from "../lib/validation/rules";

/** Rule names are written into ValidationFlag.rule and read back by the UI
 * and by grouped queries. Renaming one silently empties whatever counts it,
 * so the names are asserted, not just the behaviour. */
const EXPECTED_RULE_NAMES = ["missing_required_metric", "outlier_vs_regional_mean", "stale_data", "cross_source_deviation"];

function point(zip: string, metric: string, value: number, state = "TX"): LocationPoint {
  return { locationId: `loc-${zip}`, zip, state, metric, value };
}

interface Case {
  name: string;
  /** Rule name expected, or null when the rule must stay silent. */
  expect: string | null;
  run: () => { rule: string }[];
}

const CASES: Case[] = [
  // --- checkCompleteness ---
  {
    name: "completeness: KÊU khi thiếu chỉ số bắt buộc",
    expect: "missing_required_metric",
    run: () =>
      checkCompleteness(
        [{ locationId: "loc-1", zip: "77494" }],
        new Map([["loc-1", [point("77494", "census_median_home_value_usd", 450100)]]]),
        ["census_median_home_value_usd", "census_homeownership_rate_pct"]
      ),
  },
  {
    name: "completeness: KÊU khi location không có điểm nào (fetch hỏng)",
    expect: "missing_required_metric",
    run: () => checkCompleteness([{ locationId: "loc-1", zip: "77494" }], new Map(), ["census_median_home_value_usd"]),
  },
  {
    name: "completeness: im khi đủ chỉ số",
    expect: null,
    run: () =>
      checkCompleteness(
        [{ locationId: "loc-1", zip: "77494" }],
        new Map([["loc-1", [point("77494", "census_median_home_value_usd", 450100)]]]),
        ["census_median_home_value_usd"]
      ),
  },

  // --- checkOutliers ---
  {
    name: "outlier: KÊU khi một điểm gấp nhiều lần trung bình của phần còn lại",
    expect: "outlier_vs_regional_mean",
    run: () =>
      checkOutliers(
        [point("A", "m", 100), point("B", "m", 110), point("C", "m", 105), point("D", "m", 5000)],
        3
      ),
  },
  {
    name: "outlier: im khi các điểm sát nhau",
    expect: null,
    run: () => checkOutliers([point("A", "m", 100), point("B", "m", 110), point("C", "m", 105)], 3),
  },
  {
    name: "outlier: im khi nhóm có dưới 3 điểm (trung bình vô nghĩa)",
    expect: null,
    run: () => checkOutliers([point("A", "m", 100), point("B", "m", 99999)], 3),
  },
  {
    // REGRESSION: the ratio test needs a positive baseline, and the original
    // code skipped the group entirely when othersMean <= 0 — 245 real skipped
    // checks on this app's own data. A net-outflow state could hide any
    // outlier at all.
    name: "REGRESSION outlier: KÊU cả khi trung bình phần còn lại <= 0 (bang di cư ròng âm)",
    expect: "outlier_vs_regional_mean",
    run: () =>
      checkOutliers(
        [
          point("A", "irs_migration_net_households", -100),
          point("B", "irs_migration_net_households", -120),
          point("C", "irs_migration_net_households", -110),
          point("D", "irs_migration_net_households", -9000),
        ],
        3
      ),
  },
  {
    name: "outlier: im khi mọi điểm khác đúng bằng 0 (không có gì để so)",
    expect: null,
    run: () => checkOutliers([point("A", "m", 0), point("B", "m", 0), point("C", "m", 0), point("D", "m", 0)], 3),
  },

  // --- checkFreshness ---
  {
    name: "freshness: KÊU khi snapshot quá hạn",
    expect: "stale_data",
    run: () =>
      checkFreshness(
        [{ locationId: "loc-1", zip: "77494" }],
        new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        365
      ),
  },
  {
    name: "freshness: im khi snapshot còn hạn",
    expect: null,
    run: () =>
      checkFreshness([{ locationId: "loc-1", zip: "77494" }], new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), 365),
  },

  // --- checkCrossSource ---
  {
    name: "cross-source: KÊU khi hai nguồn lệch quá ngưỡng %",
    expect: "cross_source_deviation",
    run: () => checkCrossSource([point("A", "m", 200)], [point("A", "m", 100)], 20),
  },
  {
    name: "cross-source: im khi lệch trong ngưỡng",
    expect: null,
    run: () => checkCrossSource([point("A", "m", 105)], [point("A", "m", 100)], 20),
  },
  {
    // REGRESSION: `|| other.value === 0) continue` dropped exactly the
    // disagreements this rule exists to catch. Zero is a measurement, not a
    // reason to skip — one source reporting 0 while the other reports 2,400
    // is the loudest disagreement possible, and it was the one case
    // guaranteed to pass silently.
    name: "REGRESSION cross-source: KÊU khi nguồn kia báo 0 còn nguồn này báo khác 0",
    expect: "cross_source_deviation",
    run: () => checkCrossSource([point("A", "m", 2400)], [point("A", "m", 0)], 20),
  },
  {
    name: "cross-source: im khi cả hai nguồn cùng báo 0 (đồng thuận, không phải bất đồng)",
    expect: null,
    run: () => checkCrossSource([point("A", "m", 0)], [point("A", "m", 0)], 20),
  },
  {
    name: "cross-source: im khi không có cặp nào trùng location+metric",
    expect: null,
    run: () => checkCrossSource([point("A", "m", 200)], [point("B", "m", 100)], 20),
  },
];

function main() {
  let passed = 0;
  const failures: string[] = [];
  const rulesSeen = new Set<string>();

  for (const c of CASES) {
    const flags = c.run();
    for (const f of flags) rulesSeen.add(f.rule);

    const ok =
      c.expect === null ? flags.length === 0 : flags.length > 0 && flags.every((f) => f.rule === c.expect);

    if (ok) {
      passed++;
      console.log(`✓ ${c.name}`);
    } else {
      const got = flags.length === 0 ? "không cờ nào" : flags.map((f) => f.rule).join(", ");
      failures.push(`${c.name}\n    mong đợi: ${c.expect ?? "im lặng"}\n    nhận được: ${got}`);
      console.log(`✗ ${c.name}`);
    }
  }

  // A rule with no firing case is a rule this suite does not actually cover,
  // and its silence in production would mean nothing.
  const neverFired = EXPECTED_RULE_NAMES.filter((r) => !rulesSeen.has(r));

  console.log();
  if (failures.length > 0) {
    console.log(`${passed}/${CASES.length} test đúng. Hỏng:\n`);
    for (const f of failures) console.log(`  ${f}\n`);
  } else {
    console.log(`${passed}/${CASES.length} test đúng.`);
  }
  if (neverFired.length > 0) {
    console.log(`\n⚠️  Luật chưa có ca nào làm nó kêu: ${neverFired.join(", ")}`);
    console.log(`   Chưa chứng minh được là kêu được thì lúc nó im cũng không nói lên điều gì.`);
  } else {
    console.log(`Cả ${EXPECTED_RULE_NAMES.length} luật đều đã được chứng minh là kêu được.`);
  }

  if (failures.length > 0 || neverFired.length > 0) process.exitCode = 1;
}

main();
