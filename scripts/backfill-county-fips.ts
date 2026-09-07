// One-time backfill for Location.countyFips on rows seeded before this
// column was populated (scripts/generate-locations-from-census.ts now
// writes it for future runs). Deliberately a standalone UPDATE, not a
// re-run of seed-collector-demo.ts — that script wipes DataSnapshot/
// DataPoint/ValidationRun on every run, which would destroy already-collected
// PVWatts + Census ACS5 data just to add one column.
//
// Same real ZCTA-to-County relationship file already verified live for
// generate-locations-from-census.ts's own state derivation.

import { prisma } from "../lib/db/prisma";
import { fetchWithCurlFallback } from "../lib/net/curl-fetch";

const ZCTA_COUNTY_RELATIONSHIP_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";

async function main() {
  const locations = await prisma.location.findMany({ where: { countyFips: null } });
  if (locations.length === 0) {
    console.log("Mọi Location đã có countyFips — không có gì để backfill.");
    return;
  }
  console.log(`${locations.length} Location chưa có countyFips. Đang tải file quan hệ ZCTA-to-County...`);

  const { status, body } = await fetchWithCurlFallback(ZCTA_COUNTY_RELATIONSHIP_URL);
  if (status !== 200) {
    throw new Error(`Tải file quan hệ ZCTA-to-County thất bại: HTTP ${status}.`);
  }
  const text = body.toString("utf-8");
  const lines = text.split("\n");
  const header = lines[0].replace(/^﻿/, "").split("|");
  const zctaIdx = header.indexOf("GEOID_ZCTA5_20");
  const countyIdx = header.indexOf("GEOID_COUNTY_20");
  if (zctaIdx === -1 || countyIdx === -1) {
    throw new Error(`File quan hệ ZCTA-to-County không đúng cấu trúc mong đợi — thiếu cột. Cột nhận được: ${header.join(", ")}.`);
  }

  const zipToCountyFips = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|");
    const zip = cols[zctaIdx];
    const countyFips = cols[countyIdx];
    if (!zip || !countyFips || countyFips.length !== 5) continue;
    if (!zipToCountyFips.has(zip)) zipToCountyFips.set(zip, countyFips);
  }
  console.log(`Đã ánh xạ county FIPS cho ${zipToCountyFips.size} ZCTA trên toàn quốc.`);

  let updated = 0;
  let missing = 0;
  for (const loc of locations) {
    const countyFips = zipToCountyFips.get(loc.zip);
    if (!countyFips) {
      missing++;
      continue;
    }
    await prisma.location.update({ where: { id: loc.id }, data: { countyFips } });
    updated++;
  }

  console.log(`Đã cập nhật countyFips cho ${updated}/${locations.length} Location.`);
  if (missing > 0) {
    console.warn(`Cảnh báo: ${missing} zip không có trong file quan hệ ZCTA-to-County — countyFips vẫn để trống.`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
