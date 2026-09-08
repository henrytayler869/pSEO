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

import { snapshotStatusFor } from "../lib/collector/run";
import { ALL_VALIDATION_RULES, REQUIRED_METRICS_BY_ADAPTER, EXPECTED_METRICS_BY_ADAPTER } from "../lib/validation/config";
import { ALL_ADAPTER_KEYS } from "../lib/collector/registry";
import { describeTransportFailure } from "../lib/net/curl-fetch";
import {
  checkImpossibleValues,
  checkCompleteness,
  checkOutliers,
  checkFreshness,
  checkCrossSource,
  type LocationPoint,
} from "../lib/validation/rules";

/** Rule names are written into ValidationFlag.rule and read back by the UI
 * and by grouped queries. Renaming one silently empties whatever counts it,
 * so the names are asserted, not just the behaviour. */
/**
 * Rules that exist but cannot be made to fire by a pure-function test, named
 * one by one rather than skipped as a category — a category would quietly
 * absorb the next rule someone forgets to test.
 */
const RULES_EMITTED_ELSEWHERE = new Set<string>([
  // Set by validateSnapshot from the snapshot's own status, which needs a DB.
  "schema_drift",
]);

/**
 * Derived from the registry instead of hand-listed beside it.
 *
 * A duplicate list is a list that drifts. The registry decides what a report
 * prints as "0" — so a rule missing from it is a rule whose silence never
 * appears anywhere, and a rule in it that nothing can make fire is a zero that
 * means nothing. Both directions are checked below.
 */
const EXPECTED_RULE_NAMES = ALL_VALIDATION_RULES.filter((r) => !RULES_EMITTED_ELSEWHERE.has(r));

/**
 * Snapshot-level trust, checked separately because it sits UPSTREAM of every
 * rule above and none of them could see it.
 *
 * The per-location rules answer "is this value plausible". None of them
 * answer "did this collection produce anything at all", and on 2026-09-07
 * nothing did: the Census API returned a well-formed response with no usable
 * values, all 300 locations failed, and the snapshot was recorded OK with
 * zero data points. Every downstream check then passed — correctly, on an
 * empty set — and the run printed "cổng ĐẠT" while an empty snapshot
 * superseded 1,496 real points.
 */
const SNAPSHOT_CASES: { name: string; input: Parameters<typeof snapshotStatusFor>[0]; expect: "OK" | "SUSPECT" }[] = [
  {
    name: "snapshot: đợt thu bình thường -> OK",
    input: { driftMessage: null, pointCount: 1496, locationsAttempted: 300, locationsFailed: 4 },
    expect: "OK",
  },
  {
    // REGRESSION: the exact run that caused the damage.
    name: "REGRESSION snapshot: 300/300 địa điểm hỏng, 0 điểm dữ liệu -> SUSPECT",
    input: { driftMessage: null, pointCount: 0, locationsAttempted: 300, locationsFailed: 300 },
    expect: "SUSPECT",
  },
  {
    name: "snapshot: quá nửa địa điểm hỏng -> SUSPECT dù vẫn có dữ liệu",
    input: { driftMessage: null, pointCount: 120, locationsAttempted: 300, locationsFailed: 200 },
    expect: "SUSPECT",
  },
  {
    name: "snapshot: schema drift -> SUSPECT (hành vi cũ, phải giữ)",
    input: { driftMessage: "cột biến mất", pointCount: 900, locationsAttempted: 300, locationsFailed: 0 },
    expect: "SUSPECT",
  },
  {
    // Halting mid-run means points may already be banked. They still cannot be
    // the source's new truth: the run stopped early, so the snapshot is
    // partial by construction.
    name: "REGRESSION snapshot: không tới được nguồn -> SUSPECT dù đã thu được điểm",
    input: {
      driftMessage: null,
      unreachableMessage: "Không tới được developer.nrel.gov: không phân giải được tên miền",
      pointCount: 822,
      locationsAttempted: 288,
      locationsFailed: 1,
    },
    expect: "SUSPECT",
  },
  {
    name: "snapshot: nguồn tới được bình thường -> luật DNS im",
    input: { driftMessage: null, unreachableMessage: null, pointCount: 822, locationsAttempted: 288, locationsFailed: 2 },
    expect: "OK",
  },
  {
    name: "snapshot: vài địa điểm hỏng lẻ tẻ -> vẫn OK",
    input: { driftMessage: null, pointCount: 1180, locationsAttempted: 300, locationsFailed: 5 },
    expect: "OK",
  },
];

function point(zip: string, metric: string, value: number, state = "TX"): LocationPoint {
  return { locationId: `loc-${zip}`, zip, state, metric, value };
}


/**
 * The transport classifier gets its own array because it answers a different
 * question than a validation rule: not "is this value wrong" but "why did we
 * never get a value at all". Same discipline though — every case asserts both
 * that it names the right cause AND that it does not name a wrong one.
 */
const TRANSPORT_CASES: { name: string; expect: string; run: () => string }[] = [
  // A whole .gov zone lost its DNS delegation while that same host had been
  // returning genuine 429s for days. Two causes, one symptom upstairs. These
  // pin that the message names the cause it actually has evidence for.
  {
    name: "REGRESSION vận chuyển: curl exit 6 -> nói DNS, KHÔNG nói giới hạn tần suất",
    expect: "dns",
    run: () => {
      const e = describeTransportFailure("developer.nrel.gov", new TypeError("fetch failed"), { status: 6 });
      const namesDns = e.message.includes("không phân giải được tên miền");
      const denies = e.message.includes("KHÔNG phải giới hạn tần suất");
      const dropsFetchFailed = !e.message.includes("fetch failed");
      return namesDns && denies && dropsFetchFailed ? e.kind : `sai: ${e.message}`;
    },
  },
  {
    name: "vận chuyển: curl exit 7 -> kết nối, không phải DNS",
    expect: "connection",
    run: () => describeTransportFailure("h", new Error("x"), { status: 7 }).kind,
  },
  {
    name: "vận chuyển: không có curl status -> đọc .cause của Node",
    expect: "dns",
    run: () => {
      const inner = Object.assign(new Error("getaddrinfo ENOTFOUND h"), { code: "ENOTFOUND" });
      return describeTransportFailure("h", Object.assign(new TypeError("fetch failed"), { cause: inner }), null).kind;
    },
  },
  {
    // The honest case. When neither transport yields a recognised code the
    // message must SAY it could not classify, rather than pick the most
    // familiar cause and sound certain.
    name: "REGRESSION vận chuyển: không nhận ra -> thú nhận, không đoán bừa",
    expect: "unknown",
    run: () => {
      const e = describeTransportFailure("h", new Error("weird"), { status: 99 });
      return e.message.includes("KHÔNG nhận ra nguyên nhân") && e.message.includes("đừng suy ra là giới hạn tần suất")
        ? e.kind
        : `sai: ${e.message}`;
    },
  },
];

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

  {
    // REGRESSION. Six of seven adapters had no registered metrics, so this
    // rule returned early and reported zero flags forever — read as "đủ chỉ
    // số" when it meant "không kiểm gì".
    name: "REGRESSION completeness: thiếu chỉ số THƯỜNG CÓ -> cảnh báo, không chặn",
    expect: "missing_expected_metric",
    run: () =>
      checkCompleteness(
        [{ locationId: "A", zip: "90001" }],
        new Map([["A", [point("A", "noaa_precipitation_annual", 16.6)]]]),
        [],
        ["noaa_precipitation_annual", "noaa_heating_degree_days_annual", "noaa_cooling_degree_days_annual"]
      ),
  },
  {
    name: "completeness: đủ chỉ số thường có -> im",
    expect: null,
    run: () =>
      checkCompleteness(
        [{ locationId: "A", zip: "90001" }],
        new Map([["A", [point("A", "noaa_precipitation_annual", 16.6), point("A", "noaa_heating_degree_days_annual", 1200)]]]),
        [],
        ["noaa_precipitation_annual", "noaa_heating_degree_days_annual"]
      ),
  },
  {
    // A location the source never reached did not get a partial answer. Saying
    // "thiếu 3 chỉ số" about all 300 zips when a source is down buries the one
    // fact that matters under 300 copies of it.
    name: "REGRESSION completeness: địa điểm KHÔNG có điểm nào -> không cảnh báo thiếu-từng-phần",
    expect: null,
    run: () =>
      checkCompleteness([{ locationId: "A", zip: "90001" }], new Map(), [], ["noaa_precipitation_annual"]),
  },

  // --- checkImpossibleValues ---
  {
    // REGRESSION: 466 of 869 NOAA points were negative — sentinels summed as
    // measurements — and the statistical rules flagged none of them.
    name: "REGRESSION impossible: lượng mưa ÂM -> chặn",
    expect: "impossible_value",
    run: () => checkImpossibleValues([point("A", "noaa_precipitation_annual", -34.7)]),
  },
  {
    name: "impossible: degree-days âm -> chặn",
    expect: "impossible_value",
    run: () => checkImpossibleValues([point("A", "noaa_heating_degree_days_annual", -21690)]),
  },
  {
    // The whole point of an allow-list: this one really is signed.
    name: "impossible: di cư ròng ÂM là hợp lệ -> im",
    expect: null,
    run: () => checkImpossibleValues([point("A", "irs_migration_net_households", -12084)]),
  },
  {
    name: "impossible: 0 hợp lệ, không phải âm -> im",
    expect: null,
    run: () => checkImpossibleValues([point("A", "noaa_precipitation_annual", 0)]),
  },
  {
    // REGRESSION for the exact blind spot: the value the outlier rule flagged
    // was correct, and it must not be flagged by this rule either.
    name: "REGRESSION impossible: 14.6 inch mưa ở San Diego là ĐÚNG -> im",
    expect: null,
    run: () => checkImpossibleValues([point("A", "noaa_precipitation_annual", 14.61)]),
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

  // --- config integrity ---
  // Neither of these fails visibly in production. An unregistered adapter
  // reports "0 cờ" forever; a metric listed twice reports one gap as both a
  // block and a warning. Both look like healthy output.
  for (const key of ALL_ADAPTER_KEYS) {
    const required = REQUIRED_METRICS_BY_ADAPTER[key] ?? [];
    const expected = EXPECTED_METRICS_BY_ADAPTER[key] ?? [];
    const name = `cấu hình: adapter "${key}" có đăng ký chỉ số`;
    if (required.length > 0 || expected.length > 0) {
      passed++;
      console.log(`✓ ${name}`);
    } else {
      failures.push(`${name} — không có mục nào trong REQUIRED lẫn EXPECTED, luật completeness sẽ im vĩnh viễn`);
      console.log(`✗ ${name}`);
    }
    const both = required.filter((m) => expected.includes(m));
    const dupName = `cấu hình: "${key}" không liệt kê trùng chỉ số ở hai mức`;
    if (both.length === 0) {
      passed++;
      console.log(`✓ ${dupName}`);
    } else {
      failures.push(`${dupName} — trùng: ${both.join(", ")}, một khoảng trống sẽ bị báo hai lần ở hai mức`);
      console.log(`✗ ${dupName}`);
    }
  }
  const CONFIG_CASE_COUNT = ALL_ADAPTER_KEYS.length * 2;

  for (const c of TRANSPORT_CASES) {
    let got: string;
    try {
      got = c.run();
    } catch (err) {
      got = `ném lỗi: ${err instanceof Error ? err.message : String(err)}`;
    }
    const ok = got === c.expect;
    if (ok) passed++;
    else failures.push(`${c.name} — mong "${c.expect}", nhận "${got}"`);
    console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  }

  for (const c of SNAPSHOT_CASES) {
    const got = snapshotStatusFor(c.input);
    if (got === c.expect) {
      passed++;
      console.log(`✓ ${c.name}`);
    } else {
      failures.push(`${c.name}\n    mong đợi: ${c.expect}\n    nhận được: ${got}`);
      console.log(`✗ ${c.name}`);
    }
  }

  // A rule with no firing case is a rule this suite does not actually cover,
  // and its silence in production would mean nothing.
  const neverFired = EXPECTED_RULE_NAMES.filter((r) => !rulesSeen.has(r));
  // The other direction: a rule a test just made fire, that the registry does
  // not know about. It would be invisible in every flagCounts report — the
  // exact failure the registry exists to prevent.
  const unregistered = [...rulesSeen].filter((r) => !ALL_VALIDATION_RULES.includes(r as (typeof ALL_VALIDATION_RULES)[number]));
  if (unregistered.length > 0) {
    failures.push(
      `Luật kêu được nhưng CHƯA ĐĂNG KÝ trong ALL_VALIDATION_RULES: ${unregistered.join(", ")} — ` +
        `báo cáo sẽ không bao giờ nhắc tới chúng khi chúng im.`
    );
  }

  console.log();
  if (failures.length > 0) {
    console.log(`${passed}/${CASES.length + TRANSPORT_CASES.length + SNAPSHOT_CASES.length + CONFIG_CASE_COUNT} test đúng. Hỏng:\n`);
    for (const f of failures) console.log(`  ${f}\n`);
  } else {
    console.log(`${passed}/${CASES.length + TRANSPORT_CASES.length + SNAPSHOT_CASES.length + CONFIG_CASE_COUNT} test đúng.`);
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
