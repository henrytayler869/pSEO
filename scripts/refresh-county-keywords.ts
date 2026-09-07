// Measures search demand for COUNTY-sized places (lib/keywords/patterns.ts
// -> countySearchPlaces) and stores it in CountyKeywordMetric.
//
// Why a separate layer: keyword phrases are built from the Census "Place"
// name, and a Place can cover far more ground than people search by. Every
// NYC zip carries Place "New York", so all 48 of them — across 5 boroughs —
// inherited the single hardest phrase in the niche ("movers new york",
// KD 49) while each borough had its own easier term going unused.
//
// Uses the SAME candidate-phrasing machinery as the per-zip pipeline, so a
// borough gets the phrasing that actually has demand rather than whichever
// wording happened to be hardcoded.
//
// Usage: tsx scripts/refresh-county-keywords.ts <vertical> [--dry-run]

import { prisma } from "../lib/db/prisma";
import { resolveKeywordAdapter } from "../lib/keywords/import";
import { getKeywordTemplates, renderTemplate, getCountySearchPlaces } from "../lib/keywords/patterns";

async function main() {
  const vertical = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!vertical) {
    console.error("Cách dùng: tsx scripts/refresh-county-keywords.ts <vertical> [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const countyPlaces = await getCountySearchPlaces();
  const templates = await getKeywordTemplates(vertical);
  const entries = Object.entries(countyPlaces);

  console.log(`Ngành: ${vertical}`);
  console.log(`County có tên tìm kiếm riêng: ${entries.length}`);
  console.log(`Cách viết ứng viên (${templates.length}): ${templates.join(" | ")}`);

  // Only measure counties this app actually has Locations for — measuring a
  // county with no zips would bill DataForSEO for a phrase nothing can use.
  const known = await prisma.location.findMany({
    where: { countyFips: { in: entries.map(([fips]) => fips) } },
    select: { countyFips: true, county: true },
    distinct: ["countyFips"],
  });
  const knownFips = new Map(known.map((l) => [l.countyFips!, l.county]));
  const usable = entries.filter(([fips]) => knownFips.has(fips));
  const skipped = entries.filter(([fips]) => !knownFips.has(fips));
  if (skipped.length > 0) {
    console.log(`Bỏ qua ${skipped.length} county không có Location nào: ${skipped.map(([f]) => f).join(", ")}`);
  }
  if (usable.length === 0) {
    console.error("Không có county nào dùng được.");
    process.exitCode = 1;
    return;
  }

  const candidates = usable.flatMap(([, place]) => templates.map((t) => renderTemplate(t, vertical, place)));
  console.log(`Sẽ đo ${candidates.length} cụm từ khoá\n`);
  if (dryRun) {
    console.log("--dry-run: dừng trước khi gọi DataForSEO.");
    return;
  }

  // Reuse the market-shaped adapter by presenting each county as one
  // pseudo-market whose "city" is the borough name — that way the candidate
  // generation, measurement and best-pick logic are literally the same code
  // path as the per-zip pipeline, instead of a parallel implementation that
  // could drift from it.
  const adapter = await resolveKeywordAdapter();
  const results = await adapter.fetchForMarkets(
    usable.map(([fips, place]) => ({
      marketIdentityId: fips, // carries countyFips through the adapter
      zip: "",
      city: place,
      state: "",
      vertical,
    }))
  );

  const byFips = new Map(results.map((r) => [r.marketIdentityId, r]));
  console.log(`DataForSEO trả về ${results.length}/${usable.length} county có dữ liệu.\n`);

  const rows: { vertical: string; countyFips: string; searchPlace: string; keyword: string; searchVolume: number; keywordDifficulty: number; cpc: number; source: string }[] = [];
  console.log("county                     từ khoá thắng                     SV      KD");
  for (const [fips, place] of usable) {
    const r = byFips.get(fips);
    const label = `${fips} ${knownFips.get(fips) ?? ""}`.trim().slice(0, 24).padEnd(26);
    if (!r) {
      console.log(`${label}(không có dữ liệu — bỏ qua)`);
      continue;
    }
    console.log(`${label}${r.keyword.padEnd(34)}${String(r.searchVolume).padStart(6)}  ${r.keywordDifficulty}`);
    rows.push({
      vertical,
      countyFips: fips,
      searchPlace: place,
      keyword: r.keyword,
      searchVolume: r.searchVolume,
      keywordDifficulty: r.keywordDifficulty,
      cpc: r.cpc,
      source: adapter.sourceName,
    });
  }

  if (rows.length > 0) {
    await prisma.countyKeywordMetric.createMany({ data: rows });
    console.log(`\nĐã ghi ${rows.length} dòng CountyKeywordMetric.`);
  }

  // Show what this buys versus the zip-level keyword those same zips carry
  // today — the whole point is that the borough term should be easier.
  console.log("\nSo với từ khoá cấp zip mà các zip trong county đó đang dùng:");
  for (const row of rows) {
    const zipRow = await prisma.marketIdentity.findFirst({
      where: { vertical, zip: { in: (await prisma.location.findMany({ where: { countyFips: row.countyFips }, select: { zip: true } })).map((l) => l.zip) } },
      include: { keywordMetrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
    });
    const zk = zipRow?.keywordMetrics[0];
    if (!zk) continue;
    const easier = row.keywordDifficulty < zk.keywordDifficulty;
    console.log(
      `  ${row.searchPlace.padEnd(14)} "${row.keyword}" KD ${row.keywordDifficulty}` +
        `  vs  "${zk.keyword}" KD ${zk.keywordDifficulty}${easier ? "   ← dễ hơn" : ""}`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
