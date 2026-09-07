// Phase 2 demo: seeds the Location registry and the DataSource registry,
// then runs one PVWatts collection + validation pass.
//
// Uses the mock adapter unless NREL_API_KEY is set. Sign up for a free key
// at developer.nlr.gov/signup/ (developer.nrel.gov was retired 2026-05-29 —
// NREL renamed to NLR; see lib/collector/adapters/pvwatts.ts) and re-run
// with it set to exercise the real adapter — nothing else in this script
// changes.

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { prisma } from "../lib/db/prisma";
import { resolveAdapter } from "../lib/collector/registry";
import { runCollection } from "../lib/collector/run";
import { validateSnapshot } from "../lib/validation/run";
import { getCredential } from "../lib/settings/credentials";

const SAMPLES_DIR = path.join(process.cwd(), "data", "samples");

async function main() {
  console.log("Resetting collector demo data (Location, DataPoint, ValidationFlag/Run, DataSnapshot)...");
  await prisma.validationFlag.deleteMany();
  await prisma.validationRun.deleteMany();
  await prisma.dataPoint.deleteMany();
  await prisma.dataSnapshot.deleteMany();
  await prisma.location.deleteMany();

  console.log("Seeding DataSource registry...");
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/seed-datasources.ts", { stdio: "inherit" });

  const csv = fs.readFileSync(path.join(SAMPLES_DIR, "locations.csv"), "utf-8");
  const rows = Papa.parse<{ zip: string; city: string; state: string; lat?: string; lon?: string; countyFips?: string }>(csv, {
    header: true,
    skipEmptyLines: true,
  }).data;

  console.log(`Seeding ${rows.length} Location rows...`);
  await prisma.location.createMany({
    data: rows.map((r) => ({
      zip: r.zip,
      city: r.city,
      state: r.state,
      lat: r.lat ? Number(r.lat) : null,
      lon: r.lon ? Number(r.lon) : null,
      countyFips: r.countyFips || null,
    })),
  });

  const locations = await prisma.location.findMany();
  const locationRefs = locations.map((l) => ({ locationId: l.id, zip: l.zip, city: l.city, state: l.state, lat: l.lat, lon: l.lon, countyFips: l.countyFips }));

  // Checked via getCredential() (DB-first, .env fallback) — not raw
  // process.env — since resolveAdapter() below resolves the key the same
  // way; checking only process.env here would print "using mock" even when
  // a DB-stored key makes it actually use the real adapter.
  if (!(await getCredential("NREL_API_KEY"))) {
    process.env.ALLOW_PVWATTS_MOCK = "true";
    console.log("\nNo NREL_API_KEY configured (Cài đặt or .env) — using PvWattsMockAdapter (synthetic data, not real). See pvwatts.ts for why.");
  } else {
    console.log("\nNREL_API_KEY configured — using the real PvWattsAdapter.");
  }

  const adapter = await resolveAdapter("nrel_pvwatts");
  console.log(`Running collection for ${locationRefs.length} locations...`);
  const collectionResult = await runCollection({
    adapterKey: "nrel_pvwatts",
    adapter,
    locations: locationRefs,
  });
  console.log(
    `  -> snapshot ${collectionResult.snapshotId} (v${collectionResult.version}), status=${collectionResult.status}, ` +
      `${collectionResult.pointCount} points, ${collectionResult.locationsSucceeded} succeeded, ${collectionResult.locationsFailed} failed`
  );
  if (collectionResult.driftMessage) {
    console.log(`  DRIFT: ${collectionResult.driftMessage}`);
  }

  console.log("Running validation...");
  const validation = await validateSnapshot(collectionResult.snapshotId);
  console.log(
    `  -> ${validation.blockedLocations}/${validation.totalLocations} BLOCKED (${(validation.blockRate * 100).toFixed(1)}%), ` +
      `${validation.warnLocations} WARN, batchGatePassed=${validation.batchGatePassed}`
  );
  console.log("  flag counts by rule:", validation.flagCounts);

  console.log(`\nDone. DataSnapshot: ${collectionResult.snapshotId}, ValidationRun: ${validation.validationRunId}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
