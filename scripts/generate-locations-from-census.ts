// Real replacement for generate-locations.mjs's hand-typed 78-city anchor
// list. Pulls actual population-by-ZCTA (ZIP Code Tabulation Area — Census's
// standard proxy for ZIP codes) from the Census Bureau's public ACS 5-year
// API, ranks by population, and writes the top N to data/samples/locations.csv
// in the same shape scripts/seed-collector-demo.ts already expects
// (zip,city,state,confidenceNote) — so no downstream change is needed to
// start seeding the Location registry with real zips instead of fake ones.
//
// Also writes lat/lon (Census Gazetteer ZCTA internal-point centroid) —
// required by the PVWatts v8 collector adapter, which needs real
// coordinates now that NLR/NREL removed the "address" geocoding param
// (Feb 2025); see lib/collector/adapters/pvwatts.ts.
//
// Requires a free, instant CENSUS_API_KEY: https://api.census.gov/data/key_signup.html
//
// VERIFIED against a live key (2026-09-05): the flat nationwide ACS5 ZCTA
// query does NOT return a "state" column at all — confirmed both by the
// live response (only NAME, B01003_001E, "zip code tabulation area" come
// back) and by /data/2023/acs/acs5/geography.json, which lists "zip code
// tabulation area" with no state-nesting support (a state-scoped query,
// `in=state:06`, is rejected outright with "unknown/unsupported geography
// hierarchy"). ACS5 simply has no per-state ZCTA geography.
//
// So state comes from a second, separate real source: the Census Bureau's
// own 2020 ZCTA-to-County relationship file (a static reference file, not
// part of the api.census.gov REST API) — verified live at
// https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
// pipe-delimited, GEOID_ZCTA5_20 (col 2) = zip, GEOID_COUNTY_20 (col 10) =
// 5-digit county FIPS whose first 2 digits are the state FIPS. A ZCTA can
// map to more than one county (and, rarely, could span a state line) —
// taking the first county listed per zip is a real state, not a guess from
// the zip prefix, which is the thing worth avoiding here.
//
// City comes from the sibling 2020 ZCTA-to-Place relationship file (same
// URL pattern, "place20" instead of "county20") — Census "Place" is an
// incorporated city/town/CDP, e.g. NAMELSAD_PLACE_20 "New York city" for
// zip 10001 (verified live). A ZCTA can overlap more than one place, or
// none at all (unincorporated rural ZCTAs genuinely have no city) — the
// place with the largest area overlap (AREALAND_PART) is kept per zip;
// no match means city stays blank rather than guessed.
// https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt

import fs from "node:fs";
import path from "node:path";
import { getCredential } from "../lib/settings/credentials";

const ACS_YEAR = 2023;
const CENSUS_URL = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=NAME,B01003_001E&for=zip%20code%20tabulation%20area:*`;
const ZCTA_COUNTY_RELATIONSHIP_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";
const ZCTA_PLACE_RELATIONSHIP_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt";
// Census Gazetteer file — tab-delimited, GEOID (col 1) = zip, INTPTLAT/
// INTPTLONG (cols 6/7) = the ZCTA's internal-point centroid. Verified live
// (2026-09-05): https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/
const ZCTA_GAZETTEER_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip";
// Census NAMELSAD place names carry a legal/statistical suffix (e.g. "New
// York city", "Cook township") — stripped here purely for a clean display
// name, checked longest-first so "CDP" doesn't shadow "unified government
// CDP" etc.
const PLACE_SUFFIXES = [
  " city and borough", " municipality", " metropolitan government", " unified government",
  " metro government", " consolidated government", " urban county", " CDP", " borough",
  " township", " village", " town", " city",
];
const TOP_N_ZIPS = 300;
const OUT_DIR = path.join(process.cwd(), "data", "samples");

// Census's sentinel for a suppressed/unavailable estimate (small-population
// ZCTAs where ACS can't produce a reliable number) — not an error, just skip.
const SUPPRESSED_VALUE = -666666666;

// Standard, stable federal FIPS state code table (Census/NIST) — this
// mapping does not change; safe to hardcode. Territories included since
// Census's ZCTA universe covers them too.
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
  "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL",
  "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE",
  "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
};

// Verified (2026-09-05): Node's own fetch/https stack fails to connect to
// api.census.gov at all (ETIMEDOUT) — but curl reaches the exact same
// resolved IP in ~1s every time, immediately and repeatedly. This isn't a
// timing fluke to retry away; it's specific to Node's networking stack
// against this host (TLS fingerprinting on Census's side is the likely
// cause, though unconfirmed). Shelling out to curl is the pragmatic fix —
// used for every Census request in this script, not just the flaky one,
// since it's demonstrably the more reliable path here.
async function curlGet(url: string): Promise<{ status: number; body: Buffer }> {
  const os = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const tmpPath = path.join(os.tmpdir(), `census-fetch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const statusOut = execFileSync(
      "curl",
      ["-s", "-o", tmpPath, "-w", "%{http_code}", "--max-time", "30", "--retry", "3", "--retry-delay", "2", url],
      { encoding: "utf-8" }
    );
    return { status: Number(statusOut.trim()), body: fs.readFileSync(tmpPath) };
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

async function main() {
  const apiKey = await getCredential("CENSUS_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Chưa cấu hình CENSUS_API_KEY (ở trang Cài đặt hoặc biến môi trường). Lấy key miễn phí, cấp tức thì tại https://api.census.gov/data/key_signup.html, " +
        "sau đó thêm CENSUS_API_KEY vào .env. Không có đường tắt giả lập cho bước này — dữ liệu Location cần dùng zip thật."
    );
  }

  console.log(`Đang gọi Census ACS5 API (năm ${ACS_YEAR}) để lấy dân số theo ZCTA trên toàn quốc...`);
  const acsResponse = await curlGet(`${CENSUS_URL}&key=${apiKey}`);
  if (acsResponse.status !== 200) {
    throw new Error(`Yêu cầu Census API thất bại: HTTP ${acsResponse.status}.`);
  }

  const body: unknown = JSON.parse(acsResponse.body.toString("utf-8"));
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[0])) {
    throw new Error("Phản hồi Census API không đúng cấu trúc mong đợi (mảng hàng, hàng đầu là tiêu đề cột).");
  }

  const header = body[0] as string[];
  const populationIdx = header.indexOf("B01003_001E");
  const zctaIdx = header.findIndex((h) => h.toLowerCase().includes("zip"));
  if (populationIdx === -1 || zctaIdx === -1) {
    throw new Error(
      `Phản hồi Census API thiếu cột cần thiết (population hoặc zip). Cột nhận được: ${header.join(", ")}.`
    );
  }

  const rows = body.slice(1) as string[][];
  const byPopulation = rows
    .map((r) => ({ zip: r[zctaIdx], population: Number(r[populationIdx]) }))
    .filter((r) => Number.isFinite(r.population) && r.population !== SUPPRESSED_VALUE && r.population > 0);

  console.log(`Nhận được ${rows.length} ZCTA, ${byPopulation.length} có số liệu dân số hợp lệ.`);

  console.log("Đang tải file quan hệ ZCTA-to-County của Census (để suy ra bang thật, ACS5 không trả về cột bang)...");
  const zipToCountyFips = await fetchZctaToCountyFips();
  console.log(`Đã ánh xạ county FIPS cho ${zipToCountyFips.size} ZCTA.`);

  console.log("Đang tải file quan hệ ZCTA-to-Place của Census (để lấy tên thành phố thật, nếu có)...");
  const zipToCity = await fetchZctaToCity();
  console.log(`Đã tìm được tên thành phố cho ${zipToCity.size} ZCTA (một số ZCTA nông thôn không thuộc place nào).`);

  console.log("Đang tải Gazetteer file của Census (để lấy tọa độ thật cho PVWatts)...");
  const zipToLatLon = await fetchZctaLatLon();
  console.log(`Đã lấy tọa độ cho ${zipToLatLon.size} ZCTA.`);

  const parsed = byPopulation
    .map((r) => {
      const countyFips = zipToCountyFips.get(r.zip);
      return { ...r, countyFips, stateFips: countyFips?.slice(0, 2) };
    })
    .filter((r): r is { zip: string; population: number; countyFips: string; stateFips: string } => r.countyFips !== undefined);

  const missingState = byPopulation.length - parsed.length;
  if (missingState > 0) {
    console.warn(`Cảnh báo: ${missingState} ZCTA có dân số nhưng không có trong file quan hệ ZCTA-to-County — bị bỏ qua.`);
  }

  const unmappedFips = new Set(parsed.map((r) => r.stateFips).filter((f) => !FIPS_TO_STATE[f]));
  if (unmappedFips.size > 0) {
    console.warn(`Cảnh báo: ${unmappedFips.size} mã FIPS bang không có trong bảng tra cứu: ${[...unmappedFips].join(", ")} — các zip này sẽ bị bỏ qua.`);
  }

  const top = parsed
    .filter((r) => FIPS_TO_STATE[r.stateFips])
    .sort((a, b) => b.population - a.population)
    .slice(0, TOP_N_ZIPS);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const header_ = "zip,city,state,lat,lon,countyFips,confidenceNote";
  const withCity = top.filter((r) => zipToCity.has(r.zip)).length;
  const withLatLon = top.filter((r) => zipToLatLon.has(r.zip)).length;
  const lines = top.map((r) => {
    const latLon = zipToLatLon.get(r.zip);
    return [
      r.zip,
      csvField(zipToCity.get(r.zip) ?? ""),
      FIPS_TO_STATE[r.stateFips],
      latLon ? latLon.lat : "",
      latLon ? latLon.lon : "",
      r.countyFips,
      "census_acs5_population_real",
    ].join(",");
  });
  fs.writeFileSync(path.join(OUT_DIR, "locations.csv"), [header_, ...lines].join("\n") + "\n");

  if (withLatLon < top.length) {
    console.warn(`Cảnh báo: ${top.length - withLatLon} zip không có tọa độ trong Gazetteer file — PVWatts sẽ bỏ qua các zip này.`);
  }
  console.log(
    `\nĐã ghi ${top.length} zip thật (xếp theo dân số ACS5 ${ACS_YEAR}) vào ${path.join("data", "samples", "locations.csv")}.`
  );
  console.log(`Zip đông dân nhất: ${top[0].zip} (${zipToCity.get(top[0].zip) ?? "?"}, ${FIPS_TO_STATE[top[0].stateFips]}), dân số ước tính ${top[0].population.toLocaleString()}.`);
  console.log(`${withCity}/${top.length} zip có tên thành phố thật (từ file quan hệ ZCTA-to-Place) — số còn lại là ZCTA nông thôn không thuộc place nào, cột city để trống.`);
  console.log("\nChạy tiếp `npx tsx scripts/seed-collector-demo.ts` để nạp danh sách này vào bảng Location.");
}

/** Real Census reference file (not part of the api.census.gov REST API) —
 * pipe-delimited, GEOID_ZCTA5_20 (col index 1) = zip, GEOID_COUNTY_20 (col
 * index 9) = 5-digit county FIPS whose first 2 digits are the state FIPS.
 * A ZCTA can list more than one county; the first one seen per zip is kept
 * (fine for state derivation — spanning a state line is a rare edge case,
 * not the common case this trades off against). Returns the full 5-digit
 * county FIPS — callers wanting just the state slice the first 2 digits —
 * since the full county FIPS is itself real, useful data (county-level
 * sources like IRS SOI migration join on it directly).*/
async function fetchZctaToCountyFips(): Promise<Map<string, string>> {
  const response = await curlGet(ZCTA_COUNTY_RELATIONSHIP_URL);
  if (response.status !== 200) {
    throw new Error(`Tải file quan hệ ZCTA-to-County thất bại: HTTP ${response.status}.`);
  }
  const text = response.body.toString("utf-8");
  const lines = text.split("\n");
  const header = lines[0].replace(/^﻿/, "").split("|");
  const zctaIdx = header.indexOf("GEOID_ZCTA5_20");
  const countyIdx = header.indexOf("GEOID_COUNTY_20");
  if (zctaIdx === -1 || countyIdx === -1) {
    throw new Error(
      `File quan hệ ZCTA-to-County không đúng cấu trúc mong đợi (schema drift) — thiếu cột GEOID_ZCTA5_20/GEOID_COUNTY_20. Cột nhận được: ${header.join(", ")}.`
    );
  }

  const zipToCountyFips = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|");
    const zip = cols[zctaIdx];
    const countyFips = cols[countyIdx];
    if (!zip || !countyFips || countyFips.length !== 5) continue;
    if (!zipToCountyFips.has(zip)) zipToCountyFips.set(zip, countyFips);
  }
  return zipToCountyFips;
}

/** Same shape as fetchZctaToStateFips(), but keeps the place with the
 * largest area overlap per zip (AREALAND_PART) instead of the first one
 * seen, since picking the wrong overlapping place would produce a
 * misleading city name rather than just a less-specific state. */
async function fetchZctaToCity(): Promise<Map<string, string>> {
  const response = await curlGet(ZCTA_PLACE_RELATIONSHIP_URL);
  if (response.status !== 200) {
    throw new Error(`Tải file quan hệ ZCTA-to-Place thất bại: HTTP ${response.status}.`);
  }
  const text = response.body.toString("utf-8");
  const lines = text.split("\n");
  const header = lines[0].replace(/^﻿/, "").split("|");
  const zctaIdx = header.indexOf("GEOID_ZCTA5_20");
  const placeNameIdx = header.indexOf("NAMELSAD_PLACE_20");
  const arealandPartIdx = header.indexOf("AREALAND_PART");
  if (zctaIdx === -1 || placeNameIdx === -1 || arealandPartIdx === -1) {
    throw new Error(
      `File quan hệ ZCTA-to-Place không đúng cấu trúc mong đợi (schema drift) — thiếu cột cần thiết. Cột nhận được: ${header.join(", ")}.`
    );
  }

  const bestByZip = new Map<string, { placeName: string; arealandPart: number }>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("|");
    const zip = cols[zctaIdx];
    const placeName = cols[placeNameIdx];
    const arealandPart = Number(cols[arealandPartIdx]);
    if (!zip || !placeName || !Number.isFinite(arealandPart)) continue;
    const existing = bestByZip.get(zip);
    if (!existing || arealandPart > existing.arealandPart) {
      bestByZip.set(zip, { placeName, arealandPart });
    }
  }

  const zipToCity = new Map<string, string>();
  for (const [zip, { placeName }] of bestByZip) {
    zipToCity.set(zip, stripPlaceSuffix(placeName));
  }
  return zipToCity;
}

// Real case hit live (2026-09-05): Census's NAMELSAD for consolidated
// city-county governments can carry a trailing parenthetical, e.g.
// "Nashville-Davidson metropolitan government (balance)" — legally
// correct, but neither a clean display name nor a valid DataForSEO keyword
// input (parentheses get rejected). Strip the parenthetical first, then the
// usual suffix.
function stripPlaceSuffix(placeName: string): string {
  const withoutParenthetical = placeName.replace(/\s*\([^)]*\)\s*$/, "");
  for (const suffix of PLACE_SUFFIXES) {
    if (withoutParenthetical.endsWith(suffix)) return withoutParenthetical.slice(0, -suffix.length);
  }
  return withoutParenthetical;
}

/** The Gazetteer file ships zipped with no plain-text mirror — shells out to
 * the system `unzip` (present on macOS/Linux by default) rather than adding
 * a zip-parsing dependency for one reference-data script. */
async function fetchZctaLatLon(): Promise<Map<string, { lat: number; lon: number }>> {
  const response = await curlGet(ZCTA_GAZETTEER_URL);
  if (response.status !== 200) {
    throw new Error(`Tải Gazetteer file thất bại: HTTP ${response.status}.`);
  }

  const os = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const tmpZipPath = path.join(os.tmpdir(), `census-gazetteer-${Date.now()}.zip`);
  fs.writeFileSync(tmpZipPath, response.body);
  let text: string;
  try {
    text = execFileSync("unzip", ["-p", tmpZipPath], { maxBuffer: 1024 * 1024 * 64 }).toString("utf-8");
  } finally {
    fs.unlinkSync(tmpZipPath);
  }

  const lines = text.split("\n");
  const header = lines[0].split("\t").map((h) => h.trim());
  const zipIdx = header.indexOf("GEOID");
  const latIdx = header.indexOf("INTPTLAT");
  const lonIdx = header.indexOf("INTPTLONG");
  if (zipIdx === -1 || latIdx === -1 || lonIdx === -1) {
    throw new Error(
      `Gazetteer file không đúng cấu trúc mong đợi (schema drift) — thiếu cột GEOID/INTPTLAT/INTPTLONG. Cột nhận được: ${header.join(", ")}.`
    );
  }

  const zipToLatLon = new Map<string, { lat: number; lon: number }>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const zip = cols[zipIdx]?.trim();
    const lat = Number(cols[latIdx]);
    const lon = Number(cols[lonIdx]);
    if (!zip || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    zipToLatLon.set(zip, { lat, lon });
  }
  return zipToLatLon;
}

function csvField(value: string): string {
  return value.includes(",") || value.includes('"') ? `"${value.replace(/"/g, '""')}"` : value;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
