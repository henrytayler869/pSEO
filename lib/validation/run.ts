import { prisma } from "@/lib/db/prisma";
import { getValidationConfig, REQUIRED_METRICS_BY_ADAPTER } from "./config";
import { checkCompleteness, checkOutliers, checkFreshness, checkCrossSource, type RuleFlag, type LocationPoint } from "./rules";

export interface ValidationSummary {
  validationRunId: string;
  totalLocations: number;
  blockedLocations: number;
  warnLocations: number;
  blockRate: number;
  batchGatePassed: boolean;
  flagCounts: Record<string, number>; // by rule
}

/**
 * Runs every Module 3 check on a DataSnapshot and persists the result.
 * Assumes the snapshot was intended to cover the entire Location registry
 * (true for now — one active source, collecting for every registered zip).
 * A snapshot collection already flagged SUSPECT (schema drift) skips
 * straight to a failing result — there's no point running outlier/freshness
 * checks on data the collector itself couldn't parse reliably.
 */
export async function validateSnapshot(snapshotId: string): Promise<ValidationSummary> {
  const snapshot = await prisma.dataSnapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { source: true },
  });

  const allLocations = await prisma.location.findMany();
  const config = await getValidationConfig();

  if (snapshot.status === "SUSPECT") {
    return persistRun({
      snapshotId,
      totalLocations: allLocations.length,
      flags: allLocations.map((loc) => ({
        locationId: loc.id,
        severity: "BLOCK" as const,
        rule: "schema_drift",
        message: snapshot.statusNote ?? "Snapshot được đánh dấu Nghi ngờ trong quá trình thu thập — không thể tin cậy dữ liệu này.",
      })),
      config,
    });
  }

  const dataPoints = await prisma.dataPoint.findMany({ where: { snapshotId } });
  const locationById = new Map(allLocations.map((l) => [l.id, l]));

  const currentPoints: LocationPoint[] = dataPoints
    .map((p) => {
      const loc = locationById.get(p.locationId);
      if (!loc) return null;
      return { locationId: p.locationId, zip: loc.zip, state: loc.state, metric: p.metric, value: p.value };
    })
    .filter((p): p is LocationPoint => p !== null);

  const pointsByLocation = new Map<string, LocationPoint[]>();
  for (const p of currentPoints) {
    const list = pointsByLocation.get(p.locationId) ?? [];
    list.push(p);
    pointsByLocation.set(p.locationId, list);
  }

  const requiredMetrics = REQUIRED_METRICS_BY_ADAPTER[snapshot.source.adapterKey] ?? [];
  const completenessFlags = checkCompleteness(
    allLocations.map((l) => ({ locationId: l.id, zip: l.zip })),
    pointsByLocation,
    requiredMetrics
  );
  const outlierFlags = checkOutliers(currentPoints, config.outlierMultiplier);
  const freshnessFlags = checkFreshness(
    allLocations.map((l) => ({ locationId: l.id, zip: l.zip })),
    snapshot.fetchedAt,
    config.freshnessMaxAgeDays
  );
  const crossCheckFlags = await runCrossCheck(snapshot.sourceId, currentPoints, config.crossCheckDeviationPct);

  return persistRun({
    snapshotId,
    totalLocations: allLocations.length,
    flags: [...completenessFlags, ...outlierFlags, ...freshnessFlags, ...crossCheckFlags],
    config,
  });
}

/**
 * Cross-source agreement — and the reason its silence must not be read as
 * agreement.
 *
 * This compares points matched on locationId + METRIC NAME. Every adapter
 * here writes its own metric namespace (`census_*`, `irs_*`, `solar_*`,
 * `fema_*`, `noaa_*`, `eia_*`), so as of 2026-09-07 — 7 active sources, 17
 * metrics — the number of metrics emitted by more than one source is ZERO,
 * and this rule cannot produce a flag no matter what the data says.
 *
 * That is a fine state of affairs; what is not fine is letting "0
 * cross_source_deviation flags" sit beside rules whose zero means "checked
 * and clean". Here zero means "nothing was comparable". The counter below
 * makes the difference observable instead of leaving a reader to infer
 * reassurance the check never provided.
 *
 * The rule stays because it costs nothing and becomes live the moment two
 * sources report the same metric — which is exactly when a disagreement
 * would matter most, and exactly when nobody would think to add a check.
 */
async function runCrossCheck(
  currentSourceId: string,
  currentPoints: LocationPoint[],
  deviationPct: number
): Promise<RuleFlag[]> {
  const otherSources = await prisma.dataSource.findMany({
    where: { isActive: true, id: { not: currentSourceId } },
  });
  if (otherSources.length === 0) return [];

  const currentKeys = new Set(currentPoints.map((p) => `${p.locationId}::${p.metric}`));
  let comparablePairs = 0;

  const flags: RuleFlag[] = [];
  for (const source of otherSources) {
    const latestSnapshot = await prisma.dataSnapshot.findFirst({
      where: { sourceId: source.id, status: "OK" },
      orderBy: { version: "desc" },
    });
    if (!latestSnapshot) continue;

    const otherPoints = await prisma.dataPoint.findMany({ where: { snapshotId: latestSnapshot.id } });
    const locations = await prisma.location.findMany({ where: { id: { in: otherPoints.map((p) => p.locationId) } } });
    const locationById = new Map(locations.map((l) => [l.id, l]));

    const otherLocationPoints: LocationPoint[] = otherPoints
      .map((p) => {
        const loc = locationById.get(p.locationId);
        if (!loc) return null;
        return { locationId: p.locationId, zip: loc.zip, state: loc.state, metric: p.metric, value: p.value };
      })
      .filter((p): p is LocationPoint => p !== null);

    comparablePairs += otherLocationPoints.filter((p) => currentKeys.has(`${p.locationId}::${p.metric}`)).length;
    flags.push(...checkCrossSource(currentPoints, otherLocationPoints, deviationPct));
  }

  if (comparablePairs === 0) {
    console.warn(
      `[validation] cross-source: 0 cặp so sánh được với ${otherSources.length} nguồn khác — ` +
        `luật KHÔNG áp dụng cho lần chạy này (không nguồn nào phát cùng metric). ` +
        `Không cờ nào ở đây nghĩa là "không so được", không phải "các nguồn khớp nhau".`
    );
  }
  return flags;
}

async function persistRun(params: {
  snapshotId: string;
  totalLocations: number;
  flags: RuleFlag[];
  config: { batchBlockRateThreshold: number };
}): Promise<ValidationSummary> {
  const { snapshotId, totalLocations, flags, config } = params;

  const blockedLocationIds = new Set(flags.filter((f) => f.severity === "BLOCK").map((f) => f.locationId));
  const warnLocationIds = new Set(flags.filter((f) => f.severity === "WARN").map((f) => f.locationId));
  const blockRate = totalLocations > 0 ? blockedLocationIds.size / totalLocations : 0;
  const batchGatePassed = blockRate <= config.batchBlockRateThreshold;

  const run = await prisma.validationRun.create({
    data: {
      snapshotId,
      totalLocations,
      blockedLocations: blockedLocationIds.size,
      warnLocations: warnLocationIds.size,
      blockRate,
      batchGatePassed,
    },
  });

  if (flags.length > 0) {
    await prisma.validationFlag.createMany({
      data: flags.map((f) => ({
        validationRunId: run.id,
        locationId: f.locationId,
        severity: f.severity,
        rule: f.rule,
        message: f.message,
      })),
    });
  }

  const flagCounts: Record<string, number> = {};
  for (const f of flags) flagCounts[f.rule] = (flagCounts[f.rule] ?? 0) + 1;

  return {
    validationRunId: run.id,
    totalLocations,
    blockedLocations: blockedLocationIds.size,
    warnLocations: warnLocationIds.size,
    blockRate,
    batchGatePassed,
    flagCounts,
  };
}
