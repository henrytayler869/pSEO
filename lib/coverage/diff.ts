import { prisma } from "@/lib/db/prisma";

export interface MarketDiffRow {
  zip: string;
  city: string | null;
  state: string;
  vertical: string;
  change: "GAINED" | "LOST" | "PAYOUT_CHANGED" | "UNCHANGED";
  oldPayoutFloor?: number;
  newPayoutFloor?: number;
  payoutDeltaPct?: number;
}

export interface VerticalDiffSummary {
  vertical: string;
  gained: number;
  lost: number;
  payoutChanged: number;
  unchanged: number;
  oldZipCount: number;
  newZipCount: number;
  avgPayoutDeltaPct: number | null;
}

export interface CoverageDiffResult {
  olderImportId: string;
  newerImportId: string;
  rows: MarketDiffRow[];
  byVertical: VerticalDiffSummary[];
}

/** Compares Market snapshots between two CoverageImports, keyed by the
 * stable MarketIdentity (not a re-derived zip+vertical string) — the whole
 * point of MarketIdentity is that the same real market keeps the same id
 * across imports, so this is a direct id-to-id join. Pure read — a diff
 * never mutates either snapshot. */
export async function diffCoverageImports(
  olderImportId: string,
  newerImportId: string
): Promise<CoverageDiffResult> {
  const [olderMarkets, newerMarkets] = await Promise.all([
    prisma.market.findMany({ where: { coverageImportId: olderImportId }, include: { marketIdentity: true } }),
    prisma.market.findMany({ where: { coverageImportId: newerImportId }, include: { marketIdentity: true } }),
  ]);

  const olderByIdentity = new Map(olderMarkets.map((m) => [m.marketIdentityId, m]));
  const newerByIdentity = new Map(newerMarkets.map((m) => [m.marketIdentityId, m]));

  const rows: MarketDiffRow[] = [];
  const allIdentityIds = new Set([...olderByIdentity.keys(), ...newerByIdentity.keys()]);

  for (const identityId of allIdentityIds) {
    const older = olderByIdentity.get(identityId);
    const newer = newerByIdentity.get(identityId);

    if (older && !newer) {
      const { zip, city, state, vertical } = older.marketIdentity;
      rows.push({ zip, city, state, vertical, change: "LOST", oldPayoutFloor: older.payoutFloor });
      continue;
    }
    if (!older && newer) {
      const { zip, city, state, vertical } = newer.marketIdentity;
      rows.push({ zip, city, state, vertical, change: "GAINED", newPayoutFloor: newer.payoutFloor });
      continue;
    }
    if (older && newer) {
      const { zip, city, state, vertical } = newer.marketIdentity;
      const changed = Math.abs(older.payoutFloor - newer.payoutFloor) > 0.005;
      // % delta is undefined against a $0 old floor — guard the division
      // rather than letting it silently produce Infinity/NaN; unlikely in
      // practice for a real payout network, but nothing upstream rules it
      // out today (no CoverageImport exists yet in this system to hit it).
      const payoutDeltaPct = !changed ? 0 : older.payoutFloor !== 0 ? ((newer.payoutFloor - older.payoutFloor) / older.payoutFloor) * 100 : undefined;
      rows.push({
        zip,
        city,
        state,
        vertical,
        change: changed ? "PAYOUT_CHANGED" : "UNCHANGED",
        oldPayoutFloor: older.payoutFloor,
        newPayoutFloor: newer.payoutFloor,
        payoutDeltaPct,
      });
    }
  }

  const verticals = new Set(rows.map((r) => r.vertical));
  const byVertical: VerticalDiffSummary[] = Array.from(verticals).map((vertical) => {
    const vRows = rows.filter((r) => r.vertical === vertical);
    const payoutDeltas = vRows
      .filter((r) => r.change === "PAYOUT_CHANGED")
      .map((r) => r.payoutDeltaPct)
      .filter((v): v is number => v !== undefined);
    return {
      vertical,
      gained: vRows.filter((r) => r.change === "GAINED").length,
      lost: vRows.filter((r) => r.change === "LOST").length,
      payoutChanged: vRows.filter((r) => r.change === "PAYOUT_CHANGED").length,
      unchanged: vRows.filter((r) => r.change === "UNCHANGED").length,
      oldZipCount: vRows.filter((r) => r.change !== "GAINED").length,
      newZipCount: vRows.filter((r) => r.change !== "LOST").length,
      avgPayoutDeltaPct: payoutDeltas.length > 0 ? payoutDeltas.reduce((a, b) => a + b, 0) / payoutDeltas.length : null,
    };
  });

  return { olderImportId, newerImportId, rows, byVertical };
}
