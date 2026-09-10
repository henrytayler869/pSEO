import { prisma } from "@/lib/db/prisma";
import { formatForPrompt } from "@/lib/ai/facts";
import type { Fact } from "@/lib/ai/facts";

/**
 * Editorial article candidates, derived from collected data.
 *
 * CROSS-market on purpose. The publisher already renders one page per market
 * from this same dataset, so a per-market article would say the same thing
 * about the same ZIP on the same domain — the near-duplicate shape this
 * project built a differentiation gate to prevent.
 *
 * What a market page CANNOT say is how markets relate to each other: which
 * ZIP leads a state, how far apart the ends of a county are, which county
 * gained households while its neighbours lost them. That relation is the
 * subject here, and it exists only across rows.
 *
 * Every candidate carries the exact facts it is allowed to use. Nothing else
 * reaches the prompt, so `validateGeneratedText` applies unchanged — a
 * cross-market article is validated by the same rules as a market page.
 */

export type CandidateAngle = "zip-ranking" | "county-ranking" | "zip-spread-in-county";

export interface ArticleCandidate {
  /** Stable across runs for the same data, so a candidate already turned into
   * a post can be recognised rather than offered again. */
  id: string;
  vertical: string;
  angle: CandidateAngle;
  /** Suggested title. The writer may change it; it exists so a list of
   * candidates is readable rather than a list of metric names. */
  title: string;
  /** What makes this one worth writing, stated as the measured fact that
   * makes it true. Not a sales pitch — if the reason is thin, the candidate
   * should be skipped, and a reader can only judge that from the number. */
  why: string;
  metric: string;
  scope: { kind: "STATE" | "COUNTY"; name: string };
  /** The ONLY numbers this article may contain. */
  facts: Fact[];
}

/**
 * A metric can only rank the geography it is MEASURED at.
 *
 * This is the invariant of this whole file. Ranking ZIPs by a COUNTY-level
 * metric produces a list where every ZIP in a county holds the identical
 * value — a "top 5" that is really a tie, presented as a ranking. It would
 * read as a finding and be an artefact of the join.
 *
 * It matters most for exactly the metrics an editor would reach for first:
 * every `irs_migration_*` figure is COUNTY-resolution, and for a moving
 * company those are the interesting ones. So the rule removes the obvious
 * ideas, which is the point — they were obvious because nobody had checked
 * where the numbers are measured.
 *
 * Read from the data rather than declared, same as `metricResolutions` on the
 * contract endpoint: a hard-coded list here would be a second definition that
 * drifts the first time an adapter changes resolution.
 */
async function resolutionOf(metric: string): Promise<string | null> {
  const rows = await prisma.dataPoint.findMany({
    where: { metric },
    select: { resolvedAtResolution: true },
    distinct: ["resolvedAtResolution"],
  });
  // More than one resolution for a metric means the data disagrees with
  // itself; ranking anything by it would be ranking two different things.
  return rows.length === 1 ? rows[0].resolvedAtResolution : null;
}

function factFrom(row: {
  metric: string;
  value: number;
  unit: string;
  resolvedAtResolution: string;
  zip: string;
  city: string | null;
  state: string;
  county: string | null;
}): Fact {
  return {
    key: `${row.metric}__${row.zip}`,
    label: `${row.metric} — ${row.city ?? row.zip}, ${row.state}`,
    value: row.value,
    display: formatForPrompt(row.value, row.unit),
    unit: row.unit,
    scope: row.resolvedAtResolution as Fact["scope"],
    scopeName: row.resolvedAtResolution === "COUNTY" ? row.county : null,
  };
}

interface Row {
  metric: string;
  value: number;
  unit: string;
  resolvedAtResolution: string;
  zip: string;
  city: string | null;
  state: string;
  county: string | null;
  countyFips: string | null;
}

async function rowsFor(vertical: string, metric: string): Promise<Row[]> {
  const identities = await prisma.marketIdentity.findMany({
    where: { vertical },
    select: { zip: true },
  });
  const zips = identities.map((i) => i.zip);
  if (zips.length === 0) return [];

  const locations = await prisma.location.findMany({
    where: { zip: { in: zips } },
    select: { id: true, zip: true, city: true, state: true, county: true, countyFips: true },
  });
  const byId = new Map(locations.map((l) => [l.id, l]));

  /**
   * ONE point per location — the newest OK snapshot, nothing older.
   *
   * Without this the same ZIP appears once per collection run and a "top 5"
   * becomes the same ZIP five times. Measured before the fix: 13 snapshots per
   * (metric, location), and every single ZIP ranking was one ZIP repeated,
   * printed as five rows with identical values.
   *
   * What made it dangerous is that it looked RIGHT: five rows, sorted, a real
   * number in each. Nothing about the output said "this is one row copied".
   *
   * OK only, same as the dataset API: a SUSPECT snapshot is the collector
   * saying do not trust what this source just returned, and a ranking is
   * exactly where an untrusted figure becomes a claim about who leads.
   */
  const snapshots = await prisma.dataSnapshot.findMany({
    where: { status: "OK" },
    select: { id: true, version: true },
    orderBy: { version: "desc" },
  });
  const versionOf = new Map(snapshots.map((s) => [s.id, s.version]));

  const points = await prisma.dataPoint.findMany({
    where: { metric, locationId: { in: locations.map((l) => l.id) }, snapshotId: { in: snapshots.map((s) => s.id) } },
    select: { metric: true, value: true, unit: true, resolvedAtResolution: true, locationId: true, snapshotId: true },
  });

  const newest = new Map<string, (typeof points)[number]>();
  for (const p of points) {
    const seen = newest.get(p.locationId);
    if (!seen || (versionOf.get(p.snapshotId) ?? -1) > (versionOf.get(seen.snapshotId) ?? -1)) {
      newest.set(p.locationId, p);
    }
  }

  return [...newest.values()].flatMap((p) => {
    const loc = byId.get(p.locationId);
    if (!loc) return [];
    return [
      {
        metric: p.metric,
        value: p.value,
        unit: p.unit,
        resolvedAtResolution: p.resolvedAtResolution,
        zip: loc.zip,
        city: loc.city,
        state: loc.state,
        county: loc.county,
        countyFips: loc.countyFips,
      },
    ];
  });
}

/** How many entries a ranking article lists. Five is the smallest number that
 * still shows a shape rather than a winner; a "top 3" reads as an anecdote. */
const RANK_SIZE = 5;

/**
 * Rankings of ZIPs within a state, for ZIP-measured metrics only.
 *
 * Skipped entirely when the metric is not ZIP-resolution — see `resolutionOf`.
 */
async function zipRankings(vertical: string, metric: string): Promise<ArticleCandidate[]> {
  if ((await resolutionOf(metric)) !== "ZIP") return [];

  const rows = await rowsFor(vertical, metric);
  const byState = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byState.get(r.state) ?? [];
    list.push(r);
    byState.set(r.state, list);
  }

  const out: ArticleCandidate[] = [];
  for (const [state, list] of byState) {
    // Fewer than RANK_SIZE+1 leaves nothing to rank against — a "top 5 of 5"
    // is a list, not a ranking, and the article would be describing the whole
    // set while implying a selection was made.
    if (list.length <= RANK_SIZE) continue;

    const sorted = [...list].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, RANK_SIZE);
    const spread = top[0].value / (sorted[sorted.length - 1].value || 1);

    out.push({
      id: `${vertical}:zip-ranking:${metric}:${state}`,
      vertical,
      angle: "zip-ranking",
      title: `${RANK_SIZE} ZIP ở ${state} dẫn đầu về ${metric}`,
      why:
        `${list.length} ZIP có số liệu; cao nhất ${formatForPrompt(top[0].value, top[0].unit)} ` +
        `(${top[0].city ?? top[0].zip}), gấp ${spread.toFixed(1)} lần thấp nhất.`,
      metric,
      scope: { kind: "STATE", name: state },
      facts: top.map(factFrom),
    });
  }
  return out;
}

/**
 * Rankings of COUNTIES by a COUNTY-measured metric.
 *
 * The mirror of the rule above, and the reason the interesting metrics are
 * not lost: `irs_migration_net_households` cannot rank ZIPs, but it ranks
 * counties correctly, because that is where it is measured.
 *
 * One row per county, not per ZIP. Taking the county figure from every ZIP in
 * it and summing would multiply it by the number of ZIPs — the 13.07x error
 * the contract endpoint warns about.
 */
async function countyRankings(vertical: string, metric: string): Promise<ArticleCandidate[]> {
  if ((await resolutionOf(metric)) !== "COUNTY") return [];

  const rows = await rowsFor(vertical, metric);
  const perCounty = new Map<string, Row>();
  for (const r of rows) {
    if (!r.countyFips || !r.county) continue;
    if (!perCounty.has(r.countyFips)) perCounty.set(r.countyFips, r);
  }

  const byState = new Map<string, Row[]>();
  for (const r of perCounty.values()) {
    const list = byState.get(r.state) ?? [];
    list.push(r);
    byState.set(r.state, list);
  }

  const out: ArticleCandidate[] = [];
  for (const [state, list] of byState) {
    if (list.length <= RANK_SIZE) continue;
    const sorted = [...list].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, RANK_SIZE);

    out.push({
      id: `${vertical}:county-ranking:${metric}:${state}`,
      vertical,
      angle: "county-ranking",
      title: `${RANK_SIZE} county ở ${state} dẫn đầu về ${metric}`,
      why:
        `${list.length} county có số liệu; cao nhất ${formatForPrompt(top[0].value, top[0].unit)} ` +
        `(${top[0].county}). Chỉ số này đo ở cấp COUNTY nên xếp hạng county là đúng đơn vị.`,
      metric,
      scope: { kind: "STATE", name: state },
      facts: top.map((r) => ({ ...factFrom(r), label: `${metric} — ${r.county}, ${r.state}` })),
    });
  }
  return out;
}

/**
 * How far apart the ends of a single county are, on a ZIP-measured metric.
 *
 * Only meaningful for ZIP metrics: on a COUNTY metric every ZIP in the county
 * holds the same number and the spread is exactly 1.0 by construction — an
 * article reporting "no variation" about a figure that cannot vary.
 */
async function zipSpreadInCounty(vertical: string, metric: string): Promise<ArticleCandidate[]> {
  if ((await resolutionOf(metric)) !== "ZIP") return [];

  const rows = await rowsFor(vertical, metric);
  const byCounty = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.countyFips) continue;
    const list = byCounty.get(r.countyFips) ?? [];
    list.push(r);
    byCounty.set(r.countyFips, list);
  }

  const out: ArticleCandidate[] = [];
  for (const list of byCounty.values()) {
    if (list.length < 4) continue;
    const sorted = [...list].sort((a, b) => b.value - a.value);
    const hi = sorted[0];
    const lo = sorted[sorted.length - 1];
    if (lo.value <= 0) continue;
    const ratio = hi.value / lo.value;
    // Under 1.5x there is no story: the article would be "these places are
    // similar", which is true of most places and therefore not news.
    if (ratio < 1.5) continue;

    out.push({
      id: `${vertical}:zip-spread:${metric}:${hi.countyFips}`,
      vertical,
      angle: "zip-spread-in-county",
      title: `Chênh lệch ${ratio.toFixed(1)} lần về ${metric} bên trong ${hi.county}`,
      why:
        `${list.length} ZIP trong cùng một county, cao nhất ${formatForPrompt(hi.value, hi.unit)} ` +
        `(${hi.city ?? hi.zip}) so với ${formatForPrompt(lo.value, lo.unit)} (${lo.city ?? lo.zip}).`,
      metric,
      scope: { kind: "COUNTY", name: hi.county ?? hi.countyFips! },
      facts: [hi, lo].map(factFrom),
    });
  }
  return out;
}

export async function discoverCandidates(vertical: string): Promise<ArticleCandidate[]> {
  const metrics = await prisma.dataPoint.findMany({
    select: { metric: true },
    distinct: ["metric"],
    orderBy: { metric: "asc" },
  });

  const all: ArticleCandidate[] = [];
  for (const { metric } of metrics) {
    all.push(...(await zipRankings(vertical, metric)));
    all.push(...(await countyRankings(vertical, metric)));
    all.push(...(await zipSpreadInCounty(vertical, metric)));
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}
