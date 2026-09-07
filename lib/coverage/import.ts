import { prisma } from "@/lib/db/prisma";
import { parseCoverageFile, detectFlatRateVerticals, type ParseIssue } from "./parse";
import type { CoverageRow } from "./schema";

export interface ImportSummary {
  coverageImportId: string;
  rowCount: number;
  marketCount: number;
  issues: ParseIssue[];
  flatRateVerticals: string[];
}

/**
 * Imports a network coverage file. The raw parsed payload is stored verbatim
 * on CoverageImport (never mutated later). Each valid row resolves to a
 * MarketIdentity — the stable (zip, vertical) concept that persists across
 * every future re-import — and then a Market row, which is the
 * import-scoped snapshot of that identity's payout/pricing terms for this
 * file. Re-importing the same network/vertical data always creates a *new*
 * CoverageImport and *new* Market snapshots, but reuses the same
 * MarketIdentity rows, so score history and keyword data keep accumulating
 * against the real market instead of resetting every refresh.
 */
export async function importCoverageFile(params: {
  fileName: string;
  network: string;
  content: string;
  notes?: string;
}): Promise<ImportSummary> {
  const { fileName, network, content, notes } = params;
  const { rows, issues, rawRows } = parseCoverageFile(fileName, content);

  if (rows.length === 0) {
    throw new Error(
      `No valid rows parsed from ${fileName} (${issues.length} row-level issues). Aborting import — nothing written.`
    );
  }

  const flatRateVerticals = detectFlatRateVerticals(rows);

  const result = await prisma.$transaction(async (tx) => {
    const coverageImport = await tx.coverageImport.create({
      data: {
        fileName,
        network,
        rawPayload: rawRows as never,
        rowCount: rows.length,
        notes,
      },
    });

    // Dedup within the same file: last row wins per (zip, vertical), but we
    // don't silently drop — count is reflected in marketCount vs rowCount.
    const byKey = new Map<string, CoverageRow>();
    for (const row of rows) byKey.set(`${row.zip}::${row.vertical}`, row);
    const dedupedRows = Array.from(byKey.values());

    // Resolve MarketIdentity for every (zip, vertical) pair: reuse existing
    // ones, create the rest. City/state are frozen at first sighting — see
    // the MarketIdentity model comment for why that's an intentional
    // simplification, not an oversight.
    const existingIdentities = await tx.marketIdentity.findMany({
      where: {
        OR: dedupedRows.map((row) => ({ zip: row.zip, vertical: row.vertical })),
      },
    });
    const identityKey = (r: { zip: string; vertical: string }) => `${r.zip}::${r.vertical}`;
    const identityIdByKey = new Map(existingIdentities.map((i) => [identityKey(i), i.id]));

    const missingRows = dedupedRows.filter((row) => !identityIdByKey.has(identityKey(row)));
    if (missingRows.length > 0) {
      const created = await tx.marketIdentity.createManyAndReturn({
        data: missingRows.map((row) => ({
          zip: row.zip,
          vertical: row.vertical,
          city: row.city,
          state: row.state,
        })),
      });
      for (const identity of created) identityIdByKey.set(identityKey(identity), identity.id);
    }

    const coverageZipCountByVertical = new Map<string, number>();
    for (const row of dedupedRows) {
      coverageZipCountByVertical.set(row.vertical, (coverageZipCountByVertical.get(row.vertical) ?? 0) + 1);
    }

    await tx.market.createMany({
      data: dedupedRows.map((row) => ({
        marketIdentityId: identityIdByKey.get(identityKey(row))!,
        payoutFloor: row.payoutFloor,
        pricingModel: row.pricingModel,
        isFlatRate: flatRateVerticals.has(row.vertical),
        coverageZipCount: coverageZipCountByVertical.get(row.vertical) ?? 0,
        sourceRefreshedAt: row.sourceRefreshedAt ? new Date(row.sourceRefreshedAt) : new Date(),
        coverageImportId: coverageImport.id,
      })),
    });

    const marketCount = await tx.market.count({ where: { coverageImportId: coverageImport.id } });

    return { coverageImportId: coverageImport.id, marketCount };
  });

  return {
    coverageImportId: result.coverageImportId,
    rowCount: rows.length,
    marketCount: result.marketCount,
    issues,
    flatRateVerticals: Array.from(flatRateVerticals),
  };
}
