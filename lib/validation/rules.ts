export interface RuleFlag {
  locationId: string;
  severity: "INFO" | "WARN" | "BLOCK";
  rule: string;
  message: string;
}

export interface LocationPoint {
  locationId: string;
  zip: string;
  state: string;
  metric: string;
  value: number;
}

/** BLOCK any location missing a metric this source is required to report.
 * A location with zero points at all (fetch failed during collection) is
 * caught by this too — it's just missing every required metric. */
export function checkCompleteness(
  locations: { locationId: string; zip: string }[],
  pointsByLocation: Map<string, LocationPoint[]>,
  requiredMetrics: string[]
): RuleFlag[] {
  if (requiredMetrics.length === 0) return [];
  const flags: RuleFlag[] = [];
  for (const loc of locations) {
    const points = pointsByLocation.get(loc.locationId) ?? [];
    const haveMetrics = new Set(points.map((p) => p.metric));
    const missing = requiredMetrics.filter((m) => !haveMetrics.has(m));
    if (missing.length > 0) {
      flags.push({
        locationId: loc.locationId,
        severity: "BLOCK",
        rule: "missing_required_metric",
        message: `Thiếu chỉ số bắt buộc cho mã zip ${loc.zip}: ${missing.join(", ")}`,
      });
    }
  }
  return flags;
}

/** BLOCK a location whose value for a metric is more than `multiplier`
 * times the mean of every OTHER point for that metric within its own
 * state (leave-one-out, not a mean that includes the point being judged —
 * folding a genuine outlier into its own baseline dilutes the ratio and
 * makes it harder to trip the threshold the smaller the group is, which
 * defeats the point of the check). Regional = state, since we don't yet
 * have a populated county/metro crosswalk to group by anything finer (see
 * Location model comment) — a real limitation for states with only 1-2
 * sampled zips, where "the average of everyone else" is barely an average.
 *
 * The ratio (`value > mean * multiplier`) only makes sense against a
 * positive baseline. For a metric that can legitimately be zero or
 * negative — confirmed live, 2026-09-06: irs_migration_net_households
 * (net outflow states) — othersMean regularly comes out <= 0, and the
 * original code just skipped the whole group in that case (245 real
 * skipped checks found on this app's own collected data), meaning a real
 * outlier in a net-outflow state could never be caught at all. Falls back
 * to an absolute-deviation check (scaled by others' mean *magnitude*,
 * since the mean itself isn't a usable baseline here) instead of skipping
 * — verified against every currently-active DataSource's real collected
 * data to produce the exact same flags as before wherever the ratio check
 * already applied cleanly (zero regression), while actually evaluating the
 * cases that used to be silently skipped. */
export function checkOutliers(allPoints: LocationPoint[], multiplier: number): RuleFlag[] {
  const flags: RuleFlag[] = [];
  const byMetricAndState = new Map<string, LocationPoint[]>();
  for (const p of allPoints) {
    const key = `${p.metric}::${p.state}`;
    const list = byMetricAndState.get(key) ?? [];
    list.push(p);
    byMetricAndState.set(key, list);
  }

  for (const [key, points] of byMetricAndState) {
    if (points.length < 3) continue; // too few points for "everyone else's average" to mean anything
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const others = points.filter((_, j) => j !== i);
      const othersMean = others.reduce((sum, o) => sum + o.value, 0) / others.length;
      const [metric] = key.split("::");

      if (othersMean > 0) {
        if (p.value > othersMean * multiplier) {
          flags.push({
            locationId: p.locationId,
            severity: "BLOCK",
            rule: "outlier_vs_regional_mean",
            message: `${metric} = ${p.value} gấp ${(p.value / othersMean).toFixed(1)} lần trung bình của ${p.state} (không tính điểm này) (${othersMean.toFixed(1)}) cho mã zip ${p.zip}`,
          });
        }
        continue;
      }

      // othersMean <= 0 — a zero/negative baseline (e.g. a net-outflow
      // state for net migration). Use others' mean absolute value as the
      // "typical magnitude" scale instead of skipping the group outright.
      const othersMeanAbs = others.reduce((sum, o) => sum + Math.abs(o.value), 0) / others.length;
      if (othersMeanAbs <= 0) continue; // every other point is exactly 0 — genuinely nothing to compare against
      const deviation = Math.abs(p.value - othersMean);
      if (deviation > othersMeanAbs * multiplier) {
        flags.push({
          locationId: p.locationId,
          severity: "BLOCK",
          rule: "outlier_vs_regional_mean",
          message: `${metric} = ${p.value} lệch ${(deviation / othersMeanAbs).toFixed(1)} lần biên độ điển hình so với trung bình của ${p.state} (không tính điểm này) (${othersMean.toFixed(1)}) cho mã zip ${p.zip}`,
        });
      }
    }
  }
  return flags;
}

/** WARN every location in a snapshot whose fetchedAt is older than the
 * configured max age. Freshness is a property of the snapshot as a whole
 * (one fetchedAt for every location collected in that run), not of
 * individual DataPoints, so this applies uniformly. */
export function checkFreshness(
  locations: { locationId: string; zip: string }[],
  fetchedAt: Date,
  maxAgeDays: number
): RuleFlag[] {
  const ageDays = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= maxAgeDays) return [];
  return locations.map((loc) => ({
    locationId: loc.locationId,
    severity: "WARN" as const,
    rule: "stale_data",
    message: `Snapshot đã ${ageDays.toFixed(0)} ngày tuổi cho mã zip ${loc.zip} (tối đa ${maxAgeDays})`,
  }));
}

/** WARN where two different sources disagree by more than `deviationPct`
 * for the same metric at the same location. currentPoints and
 * otherSourcePoints are each keyed by locationId+metric; this only compares
 * pairs that exist in both. With a single active source, this returns
 * nothing — it's here so a second source (EIA, BLS, ...) slots in without
 * changing the rule itself. */
export function checkCrossSource(
  currentPoints: LocationPoint[],
  otherSourcePoints: LocationPoint[],
  deviationPct: number
): RuleFlag[] {
  const otherByKey = new Map(otherSourcePoints.map((p) => [`${p.locationId}::${p.metric}`, p]));
  const flags: RuleFlag[] = [];
  for (const p of currentPoints) {
    const other = otherByKey.get(`${p.locationId}::${p.metric}`);
    if (!other) continue;

    if (other.value === 0) {
      // % deviation is undefined against a zero baseline — but the other
      // source reporting 0 while this one reports something else is
      // itself a real, meaningful disagreement, not a case to silently
      // skip (this used to be `|| other.value === 0) continue`, which
      // dropped exactly the cases this rule exists to catch).
      if (p.value !== 0) {
        flags.push({
          locationId: p.locationId,
          severity: "WARN",
          rule: "cross_source_deviation",
          message: `${p.metric} cho mã zip ${p.zip} lệch giữa các nguồn (${p.value} so với ${other.value} — nguồn kia báo 0 nên không tính được %)`,
        });
      }
      continue;
    }

    const deviation = (Math.abs(p.value - other.value) / Math.abs(other.value)) * 100;
    if (deviation > deviationPct) {
      flags.push({
        locationId: p.locationId,
        severity: "WARN",
        rule: "cross_source_deviation",
        message: `${p.metric} cho mã zip ${p.zip} lệch ${deviation.toFixed(0)}% giữa các nguồn (${p.value} so với ${other.value})`,
      });
    }
  }
  return flags;
}

/**
 * Metrics that CAN legitimately be negative. Everything else cannot.
 *
 * An allow-list rather than a block-list, because the failure mode being
 * guarded against is a new metric arriving with no rule attached. A block-list
 * would let it through by default; this refuses it by default, and adding a
 * genuinely signed metric is one line and a moment's thought.
 */
const METRICS_THAT_MAY_BE_NEGATIVE = new Set([
  // Net migration is inflow minus outflow — negative wherever a county loses
  // more households than it gains, which is most of them in some years.
  "irs_migration_net_households",
]);

/**
 * BLOCK a value that cannot exist, regardless of what the other values look
 * like.
 *
 * Added after the statistical rules missed 466 impossible points while
 * flagging 18 correct ones. NOAA's missing-data sentinels were being summed as
 * measurements, producing annual precipitation of -34.7 inches and degree-day
 * totals of -21,690. Not one was flagged — the negatives dragged each state's
 * mean down, so the impossible values sat CLOSER to the broken average than
 * the real ones did, and checkOutliers dutifully reported the real ones.
 *
 * That is the difference between a relative check and an absolute one. A
 * comparison against neighbours can only find a value that disagrees with its
 * neighbours; when the neighbours are wrong in the same direction it points
 * confidently at whatever is right. Some facts do not depend on the
 * neighbours: rain does not fall in negative inches.
 *
 * Deliberately not a range with an upper bound. "Too large" is a judgement
 * that varies by metric and place and would need tuning; "negative rainfall"
 * needs none, and a rule that requires no tuning is one nobody will be tempted
 * to loosen when it fires inconveniently.
 */
export function checkImpossibleValues(allPoints: LocationPoint[]): RuleFlag[] {
  const flags: RuleFlag[] = [];
  for (const p of allPoints) {
    if (p.value >= 0) continue;
    if (METRICS_THAT_MAY_BE_NEGATIVE.has(p.metric)) continue;
    flags.push({
      locationId: p.locationId,
      severity: "BLOCK",
      rule: "impossible_value",
      message: `${p.metric} = ${p.value} cho mã zip ${p.zip} — chỉ số này không thể âm. Gần như chắc chắn là giá trị sentinel báo thiếu dữ liệu bị đọc như số đo thật.`,
    });
  }
  return flags;
}
