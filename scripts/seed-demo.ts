// Runs the Module 1 pipeline end-to-end against the synthetic sample data so
// the Market Explorer has something real to show. Not part of the app
// runtime — a one-off local seed for Phase 1 review.
//
// Deliberately scores v1 THEN v2 (not just v2) so this also demonstrates the
// MarketIdentity fix: a market present in both imports should carry its
// MarketScore version forward (1 -> 2) across the coverage refresh, instead
// of resetting, which is what happened before Market snapshots were split
// from a stable identity.

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../lib/db/prisma";
import { importCoverageFile } from "../lib/coverage/import";
import { importKeywordMetricsForImport } from "../lib/keywords/import";
import { computeMarketScoresForImport } from "../lib/scoring/market-score";

const SAMPLES_DIR = path.join(process.cwd(), "data", "samples");

async function main() {
  console.log("Resetting demo data...");
  await prisma.marketScore.deleteMany();
  await prisma.keywordMetric.deleteMany();
  await prisma.market.deleteMany();
  await prisma.marketIdentity.deleteMany();
  await prisma.coverageImport.deleteMany();

  const v1Content = fs.readFileSync(path.join(SAMPLES_DIR, "coverage-v1-baseline.csv"), "utf-8");
  const v2Content = fs.readFileSync(path.join(SAMPLES_DIR, "coverage-v2-current.csv"), "utf-8");
  const kwV1Content = fs.readFileSync(path.join(SAMPLES_DIR, "keyword-metrics-v1.csv"), "utf-8");
  const kwV2Content = fs.readFileSync(path.join(SAMPLES_DIR, "keyword-metrics-v2.csv"), "utf-8");

  console.log("Importing v1 (baseline, ~7 weeks old)...");
  const v1 = await importCoverageFile({
    fileName: "coverage-v1-baseline.csv",
    network: "Demo Home Services Network",
    content: v1Content,
    notes: "Synthetic baseline snapshot for diff-view demo.",
  });
  console.log(`  -> import ${v1.coverageImportId}: ${v1.marketCount} markets, flat-rate verticals: ${v1.flatRateVerticals.join(", ") || "none"}`);

  console.log("Importing keyword metrics for v1...");
  const kwV1Result = await importKeywordMetricsForImport(v1.coverageImportId, kwV1Content);
  console.log(`  -> ${kwV1Result.count} keyword rows via ${kwV1Result.sourceName}`);

  console.log("Computing MarketScore for v1...");
  const v1Scores = await computeMarketScoresForImport(v1.coverageImportId);
  console.log(`  -> ${v1Scores.length} scores computed (all should be version 1)`);

  console.log("Importing v2 (current)...");
  const v2 = await importCoverageFile({
    fileName: "coverage-v2-current.csv",
    network: "Demo Home Services Network",
    content: v2Content,
    notes: "Synthetic current snapshot.",
  });
  console.log(`  -> import ${v2.coverageImportId}: ${v2.marketCount} markets, flat-rate verticals: ${v2.flatRateVerticals.join(", ") || "none"}`);

  console.log("Importing keyword metrics for v2 (CSV fallback adapter, no DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD)...");
  const kwV2Result = await importKeywordMetricsForImport(v2.coverageImportId, kwV2Content);
  console.log(`  -> ${kwV2Result.count} keyword rows via ${kwV2Result.sourceName}, ${kwV2Result.marketsMissingData} markets missing data`);

  console.log("Computing MarketScore for v2...");
  const v2Scores = await computeMarketScoresForImport(v2.coverageImportId);
  console.log(`  -> ${v2Scores.length} scores computed`);

  // Prove the fix: pick a MarketIdentity present in both imports and show
  // its score history spans both versions, unbroken by the coverage refresh.
  const continuedIdentity = await prisma.marketIdentity.findFirst({
    where: {
      marketScores: { some: { version: 2 } },
    },
    include: { marketScores: { orderBy: { version: "asc" } } },
  });
  if (continuedIdentity) {
    console.log(
      `\nScore continuity check — ${continuedIdentity.city}, ${continuedIdentity.state} (${continuedIdentity.vertical}), identity ${continuedIdentity.id}:`
    );
    for (const s of continuedIdentity.marketScores) {
      console.log(`  version ${s.version}: score=${s.score.toFixed(1)} (computed ${s.calculatedAt.toISOString()})`);
    }
  } else {
    console.log("\nNo identity reached version 2 — check that v1 and v2 keyword CSVs overlap on scored markets.");
  }

  console.log("\nDone. CoverageImport IDs:");
  console.log(`  v1 (baseline): ${v1.coverageImportId}`);
  console.log(`  v2 (current):  ${v2.coverageImportId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
