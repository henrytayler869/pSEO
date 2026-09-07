// Populates Location.county (the human-readable county name, e.g. "Bexar
// County") for every Location that has a countyFips but no name yet.
//
// Why this exists: /api/v1 could return countyFips but never a county
// *name*, while IRS/FEMA metrics are reported at COUNTY resolution and
// attributed down to each zip (isInferred: true). A consuming site is
// required to disclose that scope honestly — "across the county containing
// ZIP 78245" is accurate but clumsy, and guessing "Bexar County" from the
// FIPS code would be fabricating data. So the name has to come from a real
// source or not be offered at all.
//
// Source: the exact same IRS SOI county migration file the irs_migration
// adapter already downloads (lib/collector/adapters/irs-migration.ts). Its
// y1_statefips / y1_countyfips / y1_countyname columns are a real,
// authoritative FIPS -> name mapping (3,158 counties) — no new dependency,
// no new endpoint, no guessed names.
//
// Known, real gaps (same ones documented for irs_migration itself): Puerto
// Rico is essentially absent from this dataset, and Connecticut's legacy
// county FIPS don't match the Planning Region FIPS the IRS now uses. Those
// Locations keep county = null, and the API simply omits the name for them
// rather than inventing one.

import { prisma } from "../lib/db/prisma";
import { fetchWithCurlFallback } from "../lib/net/curl-fetch";

const IRS_INFLOW_URL = "https://www.irs.gov/pub/irs-soi/countyinflow2223.csv";

async function buildFipsToCountyName(): Promise<Map<string, string>> {
  const { status, body } = await fetchWithCurlFallback(IRS_INFLOW_URL);
  if (status !== 200) {
    throw new Error(`Tải file IRS thất bại: HTTP ${status}`);
  }

  const lines = body.toString("utf-8").split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split(",");
  const stateIdx = header.indexOf("y1_statefips");
  const countyIdx = header.indexOf("y1_countyfips");
  const nameIdx = header.indexOf("y1_countyname");
  if ([stateIdx, countyIdx, nameIdx].includes(-1)) {
    throw new Error(`File IRS thiếu cột mong đợi. Cột nhận được: ${header.join(", ")}`);
  }

  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const fips = `${cols[stateIdx]}${cols[countyIdx]}`;
    const name = (cols[nameIdx] ?? "").trim();
    // Skip the special aggregate rows (state FIPS 96/97/98 = US/Foreign
    // totals, not real counties) and anything without a usable name.
    if (!name || name.includes("Total Migration") || ["96", "97", "98"].includes(cols[stateIdx])) continue;
    if (!map.has(fips)) map.set(fips, name);
  }
  return map;
}

async function main() {
  console.log("Đang tải bảng tra FIPS -> tên hạt từ file IRS SOI...");
  const fipsToName = await buildFipsToCountyName();
  console.log(`Đã dựng bảng tra với ${fipsToName.size} hạt.`);

  const locations = await prisma.location.findMany({
    where: { countyFips: { not: null } },
    select: { id: true, zip: true, state: true, countyFips: true },
  });

  let updated = 0;
  const unresolved: string[] = [];
  for (const loc of locations) {
    const name = fipsToName.get(loc.countyFips!);
    if (!name) {
      unresolved.push(`${loc.zip} ${loc.state} (fips ${loc.countyFips})`);
      continue;
    }
    await prisma.location.update({ where: { id: loc.id }, data: { county: name } });
    updated++;
  }

  console.log(`Đã cập nhật tên hạt cho ${updated}/${locations.length} Location.`);
  if (unresolved.length > 0) {
    console.log(
      `${unresolved.length} Location không tra được tên (khoảng trống thật của dữ liệu IRS — Puerto Rico, ` +
        `và Connecticut đã đổi sang mã Planning Region):`
    );
    for (const u of unresolved) console.log(`  - ${u}`);
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
