import { prisma } from "@/lib/db/prisma";

const SIGNIFICANT_CHANGE_THRESHOLD_PCT = 10;

export interface MetricDelta {
  metric: string;
  unit: string;
  previousAvg: number;
  currentAvg: number;
  // (currentAvg - previousAvg) / previousAvg * 100 — null when previousAvg
  // is 0: percent change is undefined against a zero baseline, not "0%"
  // (going from 0 to any nonzero value is a real, meaningful change with
  // no finite percentage to express it as).
  percentChange: number | null;
  sampleSize: number; // locations with a value for this metric in BOTH snapshots
  significantChangeCount: number; // of those, how many moved >= 10% either direction (or from exactly 0 to nonzero)
}

export interface SnapshotComparison {
  /** Versions between the compared pair that were skipped because they were
   * not OK. Empty in the normal case. Non-empty is itself the headline. */
  skippedSuspectVersions: number[];
  previousSnapshotId: string;
  previousVersion: number;
  currentVersion: number;
  metrics: MetricDelta[];
}

/**
 * Compares a snapshot against the immediately preceding one FOR THE SAME
 * SOURCE (by version, not by date — a source's own version sequence is
 * what "previous" means here, matching how DataSnapshot is already
 * versioned). Per-location values are paired by locationId so the delta is
 * a real like-for-like comparison, not just "average of run N vs average of
 * run N-1" (which could mask real per-zip swings if the location set
 * shifted between runs). Returns null when there's no earlier snapshot for
 * this source yet — a first-ever run has nothing to compare against, which
 * is a normal state, not an error.
 */
export async function compareToPreviousSnapshot(currentSnapshotId: string): Promise<SnapshotComparison | null> {
  const current = await prisma.dataSnapshot.findUnique({ where: { id: currentSnapshotId } });
  if (!current) return null;

  /**
   * Compare against the last snapshot anyone TRUSTS, not merely the last one
   * taken.
   *
   * This used to pick `version < current` ordered by version, with no regard
   * for status — so a run could be measured against data the system had
   * already decided not to serve. That makes both answers wrong in different
   * ways: a real improvement reads as an alarming delta, and worse, if the
   * broken snapshot and the new one are broken alike, the comparison reports
   * "no significant change" — a reassurance computed from two measurements of
   * the same fault.
   *
   * Downstream reads the latest OK snapshot. Matching that here makes "what
   * changed" mean what changed for the people consuming the data.
   *
   * The skipped versions are reported rather than dropped: a gap between
   * version numbers is exactly the sort of thing a reader notices and
   * misreads, and it is also the news — a source that has been failing since
   * v13 matters more than any delta on this page.
   */
  const previous = await prisma.dataSnapshot.findFirst({
    where: { sourceId: current.sourceId, version: { lt: current.version }, status: "OK" },
    orderBy: { version: "desc" },
  });
  if (!previous) return null;

  const skippedSuspect = await prisma.dataSnapshot.findMany({
    where: {
      sourceId: current.sourceId,
      version: { lt: current.version, gt: previous.version },
    },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const [currentPoints, previousPoints] = await Promise.all([
    prisma.dataPoint.findMany({ where: { snapshotId: current.id } }),
    prisma.dataPoint.findMany({ where: { snapshotId: previous.id } }),
  ]);

  return {
    previousSnapshotId: previous.id,
    previousVersion: previous.version,
    currentVersion: current.version,
    skippedSuspectVersions: skippedSuspect.map((s) => s.version),
    metrics: computeMetricDeltas(currentPoints, previousPoints),
  };
}

/**
 * The delta arithmetic, with no database in it.
 *
 * Split out to be tested. Everything interesting here is an edge case — a
 * metric present in one snapshot and not the other, a previous value of zero,
 * an average taken over a shifting set of locations — and none of it was
 * exercised by anything.
 */
export function computeMetricDeltas(
  currentPoints: { locationId: string; metric: string; value: number; unit: string }[],
  previousPoints: { locationId: string; metric: string; value: number; unit: string }[]
): MetricDelta[] {
  const currentByMetric = groupByMetricThenLocation(currentPoints);
  const previousByMetric = groupByMetricThenLocation(previousPoints);

  const metrics: MetricDelta[] = [];
  const allMetricKeys = new Set([...currentByMetric.keys(), ...previousByMetric.keys()]);
  for (const metric of allMetricKeys) {
    const currentByLoc = currentByMetric.get(metric) ?? new Map();
    const previousByLoc = previousByMetric.get(metric) ?? new Map();
    const commonLocationIds = [...currentByLoc.keys()].filter((id) => previousByLoc.has(id));
    if (commonLocationIds.length === 0) continue;

    let currentSum = 0;
    let previousSum = 0;
    let significantChangeCount = 0;
    let unit = "";
    for (const locId of commonLocationIds) {
      const curr = currentByLoc.get(locId)!;
      const prev = previousByLoc.get(locId)!;
      currentSum += curr.value;
      previousSum += prev.value;
      unit = curr.unit;
      // A zero-to-nonzero change (e.g. a county with 0 FEMA declarations
      // last snapshot getting a real new one) is always significant — it
      // used to default to "0% change" and never count, silently hiding
      // exactly the kind of event this comparison exists to surface.
      const isSignificant =
        prev.value === 0
          ? curr.value !== 0
          : Math.abs(((curr.value - prev.value) / prev.value) * 100) >= SIGNIFICANT_CHANGE_THRESHOLD_PCT;
      if (isSignificant) significantChangeCount++;
    }
    const currentAvg = currentSum / commonLocationIds.length;
    const previousAvg = previousSum / commonLocationIds.length;
    const percentChange = previousAvg !== 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : currentAvg !== 0 ? null : 0;

    metrics.push({ metric, unit, previousAvg, currentAvg, percentChange, sampleSize: commonLocationIds.length, significantChangeCount });
  }

  return metrics;
}

/** Shared display formatting for a possibly-undefined percent change, so
 * every consumer (Collector UI, the scheduled-collection CLI, the action
 * result message) renders the null case the same way instead of each
 * re-deriving its own "from zero" wording. */
export function formatPercentChange(percentChange: number | null): string {
  if (percentChange === null) return "N/A (từ 0)";
  return `${percentChange >= 0 ? "+" : ""}${percentChange.toFixed(1)}%`;
}

function groupByMetricThenLocation(
  points: { locationId: string; metric: string; value: number; unit: string }[]
): Map<string, Map<string, { value: number; unit: string }>> {
  const byMetric = new Map<string, Map<string, { value: number; unit: string }>>();
  for (const p of points) {
    const byLocation = byMetric.get(p.metric) ?? new Map();
    byLocation.set(p.locationId, { value: p.value, unit: p.unit });
    byMetric.set(p.metric, byLocation);
  }
  return byMetric;
}
