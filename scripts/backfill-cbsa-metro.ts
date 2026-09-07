// Populates Location.metro + Location.cbsaCode from the Census/OMB Core
// Based Statistical Area delineation file.
//
// Why: both columns have existed in the schema since the start but were
// NEVER written (0/300) — generate-locations-from-census.ts collects
// zip/city/state/lat/lon/countyFips and nothing else. An always-null field
// is worse than a missing one: a consumer writes a fallback branch, the
// branch runs 100% of the time, and the consumer reports "using metro
// data" while using none. So this fills them for real or leaves them null.
//
// Source: the official July 2023 delineation file (list1_2023.xlsx). It maps
// FIPS state + county -> CBSA code + CBSA title, and countyFips is already
// populated for 300/300 Locations, so this is a clean join on a real key —
// no name matching, no guessing.
//
// Parsing note: .xlsx is a ZIP of XML. Rather than adding a spreadsheet
// dependency, this unzips with Node's zlib via a minimal reader and pulls
// values out of sheet1.xml + sharedStrings.xml. Two real traps handled:
//   1. Blank cells are OMITTED entirely, so cell position cannot be
//      inferred from order — the column letter in each cell's r="D4"
//      attribute is the only reliable mapping.
//   2. Self-closing cells (<c r="B4"/>) must be matched separately, or a
//      naive regex swallows the following real cell.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/db/prisma";
import { fetchWithCurlFallback } from "../lib/net/curl-fetch";

const DELINEATION_URL =
  "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx";

// Column letters from the header row (row 3 of the sheet).
const COL_CBSA_CODE = "A";
const COL_CBSA_TITLE = "D";
const COL_FIPS_STATE = "J";
const COL_FIPS_COUNTY = "K";

interface CbsaEntry {
  cbsaCode: string;
  cbsaTitle: string;
}

function readSharedStrings(xml: string): string[] {
  // A <si> can hold several <t> runs (rich text) — concatenate them.
  return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map(([, si]) =>
    Array.from(si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map(([, t]) => t)
      .join("")
  );
}

/** Column letter -> value, for one row. Only cells that exist are present. */
function readRow(rowXml: string, strings: string[]): Map<string, string> {
  const out = new Map<string, string>();
  // Self-closing cells first so the greedy open/close pattern can't swallow them.
  const cellPattern = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  for (const m of rowXml.matchAll(cellPattern)) {
    const attrs = m[1] ?? m[2] ?? "";
    const inner = m[3] ?? "";
    const ref = /\sr="([A-Z]+)\d+"/.exec(attrs)?.[1];
    if (!ref) continue;
    const isShared = /\st="s"/.test(attrs);
    const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    if (raw === undefined) continue;
    const value = isShared ? (strings[Number(raw)] ?? "") : raw;
    if (value !== "") out.set(ref, value);
  }
  return out;
}

async function buildCountyFipsToCbsa(): Promise<Map<string, CbsaEntry>> {
  const { status, body } = await fetchWithCurlFallback(DELINEATION_URL);
  if (status !== 200) throw new Error(`Tải file phân định CBSA thất bại: HTTP ${status}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbsa-"));
  try {
    const xlsxPath = path.join(tmpDir, "list1.xlsx");
    fs.writeFileSync(xlsxPath, body);
    // `unzip` is already an assumed-present shell tool in this codebase's
    // Census pipeline (the Gazetteer file ships as a .zip too).
    execFileSync("unzip", ["-o", "-q", xlsxPath, "-d", path.join(tmpDir, "x")]);

    const strings = readSharedStrings(fs.readFileSync(path.join(tmpDir, "x/xl/sharedStrings.xml"), "utf-8"));
    const sheet = fs.readFileSync(path.join(tmpDir, "x/xl/worksheets/sheet1.xml"), "utf-8");

    const map = new Map<string, CbsaEntry>();
    for (const [, rowXml] of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = readRow(rowXml, strings);
      const stateFips = cells.get(COL_FIPS_STATE);
      const countyFips = cells.get(COL_FIPS_COUNTY);
      const cbsaCode = cells.get(COL_CBSA_CODE);
      const cbsaTitle = cells.get(COL_CBSA_TITLE);
      // Header/title rows lack a numeric FIPS pair, which filters them out
      // without having to hardcode "skip the first 3 rows".
      if (!stateFips || !countyFips || !cbsaCode || !cbsaTitle) continue;
      if (!/^\d{2}$/.test(stateFips) || !/^\d{3}$/.test(countyFips)) continue;
      map.set(`${stateFips}${countyFips}`, { cbsaCode, cbsaTitle });
    }
    return map;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Đang tải file phân định CBSA (Census/OMB, tháng 7/2023)...");
  const fipsToCbsa = await buildCountyFipsToCbsa();
  console.log(`Đã dựng bảng tra: ${fipsToCbsa.size} county có CBSA.`);
  if (fipsToCbsa.size < 1000) {
    throw new Error(`Chỉ parse được ${fipsToCbsa.size} county — file có ~1900 dòng dữ liệu, nhiều khả năng parse sai. Dừng để không ghi dữ liệu hỏng.`);
  }

  const locations = await prisma.location.findMany({
    where: { countyFips: { not: null } },
    select: { id: true, zip: true, state: true, countyFips: true },
  });

  let updated = 0;
  const unresolved: string[] = [];
  for (const loc of locations) {
    const entry = fipsToCbsa.get(loc.countyFips!);
    if (!entry) {
      unresolved.push(`${loc.zip} ${loc.state} (fips ${loc.countyFips})`);
      continue;
    }
    await prisma.location.update({
      where: { id: loc.id },
      data: { metro: entry.cbsaTitle, cbsaCode: entry.cbsaCode },
    });
    updated++;
  }

  console.log(`Đã cập nhật metro + cbsaCode cho ${updated}/${locations.length} Location.`);
  if (unresolved.length > 0) {
    console.log(
      `${unresolved.length} Location không thuộc CBSA nào — đây là kết quả THẬT, không phải lỗi: ` +
        `county nông thôn nằm ngoài mọi vùng đô thị/tiểu đô thị thì không có CBSA.`
    );
    for (const u of unresolved.slice(0, 15)) console.log(`  - ${u}`);
    if (unresolved.length > 15) console.log(`  ... và ${unresolved.length - 15} nữa`);
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
