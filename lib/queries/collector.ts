import { prisma } from "@/lib/db/prisma";
import { compareToPreviousSnapshot, type SnapshotComparison } from "@/lib/collector/compare";

export async function getDataSources() {
  return prisma.dataSource.findMany({ orderBy: { name: "asc" } });
}

export interface SourceComparisonRow {
  sourceName: string;
  currentVersion: number;
  comparison: SnapshotComparison | null;
}

/** Latest-vs-previous delta for every active source's most recent snapshot
 * — computed fresh on every page load (no caching), same "always live"
 * philosophy as the rest of this app's aggregate views. */
export async function getLatestComparisons(): Promise<SourceComparisonRow[]> {
  const sources = await prisma.dataSource.findMany({ where: { isActive: true } });
  const rows: SourceComparisonRow[] = [];
  for (const source of sources) {
    const latest = await prisma.dataSnapshot.findFirst({
      where: { sourceId: source.id },
      orderBy: { version: "desc" },
    });
    if (!latest) continue;
    rows.push({
      sourceName: source.name,
      currentVersion: latest.version,
      comparison: await compareToPreviousSnapshot(latest.id),
    });
  }
  return rows;
}

export async function getSnapshotsWithSource() {
  return prisma.dataSnapshot.findMany({
    include: { source: true, validationRuns: { orderBy: { runAt: "desc" }, take: 1 } },
    orderBy: { fetchedAt: "desc" },
  });
}

export interface RealDataPointRow {
  sourceName: string;
  adapterKey: string;
  metric: string;
  value: number;
  unit: string;
  resolvedAtResolution: string;
  isInferred: boolean;
  confidence: number;
  snapshotVersion: number;
  fetchedAt: Date;
}

/** Every real collected DataPoint relevant to one (zip, vertical) pair, from
 * the latest OK snapshot of each active DataSource tagged for that vertical
 * — the join the Public Dataset API needs to actually hand a plugin the
 * Census/IRS/NOAA/EIA/FEMA/PVWatts numbers behind a page, not just keyword
 * data. Returns [] (not an error) when the zip has no Location row at all —
 * Module 1 (keyword research) and Module 2 (Collector) run over
 * independently-defined zip lists, so a researched market having no real
 * government data yet is an expected, surfaceable state, not a bug. Only
 * OK snapshots are considered: a SUSPECT snapshot (schema drift) is exactly
 * the "don't trust what this source just returned" signal validateSnapshot
 * exists to produce, so it must not leak into published pages. */
export async function getRealDataPointsForZipAndVertical(zip: string, vertical: string): Promise<RealDataPointRow[]> {
  const location = await prisma.location.findFirst({ where: { zip } });
  if (!location) return [];

  const sources = await prisma.dataSource.findMany({
    where: { isActive: true, relevantVerticals: { has: vertical } },
  });
  if (sources.length === 0) return [];

  const rows: RealDataPointRow[] = [];
  for (const source of sources) {
    const snapshot = await prisma.dataSnapshot.findFirst({
      where: { sourceId: source.id, status: "OK" },
      orderBy: { version: "desc" },
    });
    if (!snapshot) continue;

    const points = await prisma.dataPoint.findMany({ where: { snapshotId: snapshot.id, locationId: location.id } });
    for (const point of points) {
      rows.push({
        sourceName: source.name,
        adapterKey: source.adapterKey,
        metric: point.metric,
        value: point.value,
        unit: point.unit,
        resolvedAtResolution: point.resolvedAtResolution,
        isInferred: point.isInferred,
        confidence: point.confidence,
        snapshotVersion: snapshot.version,
        fetchedAt: snapshot.fetchedAt,
      });
    }
  }
  return rows;
}

export async function getSnapshotDetail(snapshotId: string) {
  const snapshot = await prisma.dataSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      source: true,
      validationRuns: {
        orderBy: { runAt: "desc" },
        take: 1,
        include: {
          flags: {
            include: { location: true },
            orderBy: [{ severity: "desc" }, { rule: "asc" }],
          },
        },
      },
    },
  });
  return snapshot;
}

export interface CountyKeywordRow {
  keyword: string;
  searchPlace: string;
  searchVolume: number;
  cpc: number;
  keywordDifficulty: number;
  measuredAt: Date;
}

/** The measured keyword for the COUNTY a zip sits in, when that county has
 * a colloquial name people actually search by (currently the five NYC
 * boroughs — see lib/keywords/patterns.ts::countySearchPlaces).
 *
 * Exists because `mainKeyword` is derived from the Census "Place" name, and
 * a Place can be far bigger than the geography people search: all 48 NYC
 * zips share Place "New York", so each borough inherits the single hardest
 * phrase in the niche instead of its own much easier one. Returns null for
 * the vast majority of zips — most counties have no distinct search name,
 * and inventing one would be fabricating a place. */
export async function getCountyKeywordForZip(zip: string, vertical: string): Promise<CountyKeywordRow | null> {
  const location = await prisma.location.findFirst({ where: { zip }, select: { countyFips: true } });
  if (!location?.countyFips) return null;

  const row = await prisma.countyKeywordMetric.findFirst({
    where: { vertical, countyFips: location.countyFips },
    orderBy: { fetchedAt: "desc" },
  });
  if (!row) return null;

  return {
    keyword: row.keyword,
    searchPlace: row.searchPlace,
    searchVolume: row.searchVolume,
    cpc: row.cpc,
    keywordDifficulty: row.keywordDifficulty,
    measuredAt: row.fetchedAt,
  };
}
