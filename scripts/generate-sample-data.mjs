// Generates sample coverage + keyword data for local dev / Phase 1 review.
// This is clearly-labeled synthetic data, not a real network export. It
// exists so Module 1 (Market Explorer) can be exercised end-to-end without
// live Ahrefs credentials or a real coverage file from a network.
//
// Design choices baked in on purpose, so the UI has something real to gate on:
//  - "water-damage-restoration" pays a literal flat rate everywhere -> isFlatRate
//    auto-detection should catch it.
//  - "roofing-replacement" (PER_APPOINTMENT) has payout deliberately correlated
//    with keyword difficulty in big metros -> should trip the payout/KD trap warning.
//  - "hvac-repair" and "garage-door-repair" vary more randomly, as a contrast case.
//  - Two coverage import snapshots (v1, v2) are produced with deliberate deltas
//    (coverage gained/lost, payout changed) so the diff view has real diffs to render.

import fs from "node:fs";
import path from "node:path";
import { CITIES } from "./us-cities.mjs";

const OUT_DIR = path.join(process.cwd(), "data", "samples");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Deterministic PRNG so re-running produces identical files (no Math.random
// left lying around for reproducibility of the demo dataset).
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const jitter = (base, pct) => base * (1 + (rand() * 2 - 1) * pct);

const VERTICALS = {
  "water-damage-restoration": {
    pricingModel: "PER_CALL_DURATION",
    flat: 38, // literal flat rate nationwide, on purpose
    volumeBase: 90,
    kdBase: 28,
    cpcBase: 14,
  },
  "hvac-repair": {
    pricingModel: "PER_CALL_DURATION",
    payoutBase: { 1: 42, 2: 33, 3: 26 },
    volumeBase: { 1: 1400, 2: 650, 3: 260 },
    // KD deliberately NOT tier-scaled — local competitive intensity varies
    // independently of metro size for this vertical, so payout and KD
    // shouldn't correlate. Contrast case against the roofing trap below.
    kdBase: { 1: 30, 2: 30, 3: 30 },
    kdJitterPct: 0.4,
    cpcBase: { 1: 19, 2: 15, 3: 11 },
  },
  "roofing-replacement": {
    pricingModel: "PER_APPOINTMENT",
    payoutBase: { 1: 195, 2: 140, 3: 95 }, // high payout in big metros...
    volumeBase: { 1: 1800, 2: 800, 3: 300 },
    kdBase: { 1: 71, 2: 52, 3: 33 }, // ...and high KD there too -> the trap
    cpcBase: { 1: 38, 2: 27, 3: 17 },
  },
  "garage-door-repair": {
    pricingModel: "CPL",
    payoutBase: { 1: 19, 2: 14, 3: 9 },
    volumeBase: { 1: 480, 2: 240, 3: 110 },
    // Same decoupling as hvac-repair, for the same reason.
    kdBase: { 1: 18, 2: 18, 3: 18 },
    kdJitterPct: 0.4,
    cpcBase: { 1: 9, 2: 7, 3: 5 },
  },
};

function buildRow(city, zip, state, tier, vertical, def) {
  const isFlat = def.flat !== undefined;
  const payoutFloor = isFlat ? def.flat : Math.round(jitter(def.payoutBase[tier], 0.18) * 100) / 100;
  return { city, zip, state, vertical, payoutFloor, pricingModel: def.pricingModel, isFlatRate: isFlat, tier };
}

function buildKeywordRow(row, def) {
  const vol = def.flat !== undefined ? def.volumeBase : def.volumeBase[row.tier];
  const kd = def.flat !== undefined ? def.kdBase : def.kdBase[row.tier];
  const cpc = def.flat !== undefined ? def.cpcBase : def.cpcBase[row.tier];
  const kdJitterPct = def.kdJitterPct ?? 0.15;
  return {
    zip: row.zip,
    vertical: row.vertical,
    keyword: `${row.vertical.replace(/-/g, " ")} ${row.city.toLowerCase()}`,
    searchVolume: Math.max(10, Math.round(jitter(vol, 0.35))),
    keywordDifficulty: Math.min(97, Math.max(4, Math.round(jitter(kd, kdJitterPct)))),
    cpc: Math.round(jitter(cpc, 0.25) * 100) / 100,
  };
}

// --- Build the canonical full grid: every city x every vertical ---
const fullGrid = [];
for (const [city, zip, state, tier] of CITIES) {
  for (const [vertical, def] of Object.entries(VERTICALS)) {
    fullGrid.push(buildRow(city, zip, state, tier, vertical, def));
  }
}

// v1 (baseline) and v2 (current) are each independently derived from the
// same full grid, using a per-vertical row index (not a shared cursor) so
// the drop conditions below can't silently fail to fire from modulo/offset
// parity mismatches. Two distinct, clearly-attributable stories:
//   - roofing-replacement: present in v1, DROPPED in v2 (network pulled back
//     coverage) -> shows up as "LOST" in the diff.
//   - hvac-repair: MISSING in v1, present in v2 (network expanded) -> shows
//     up as "GAINED" in the diff.
// payoutFloor for hvac + roofing also shifts in ~40% of the rows that exist
// in both snapshots, so the diff has real PAYOUT_CHANGED rows too.
const verticalRowIndex = new Map(); // vertical -> running count, incremented per row of that vertical
function nextIndexFor(vertical) {
  const i = verticalRowIndex.get(vertical) ?? 0;
  verticalRowIndex.set(vertical, i + 1);
  return i;
}

const v1Rows = [];
const v2Rows = [];
for (const row of fullGrid) {
  const idx = nextIndexFor(row.vertical);

  const droppedInV2 = row.vertical === "roofing-replacement" && idx % 8 === 0;
  const missingInV1 = row.vertical === "hvac-repair" && idx % 7 === 0;

  if (!missingInV1) v1Rows.push({ ...row });
  if (!droppedInV2) {
    const v2Row = { ...row };
    if ((row.vertical === "hvac-repair" || row.vertical === "roofing-replacement") && idx % 5 === 0) {
      v2Row.payoutFloor = Math.round(jitter(row.payoutFloor, 0.22) * 100) / 100;
    }
    v2Rows.push(v2Row);
  }
}

function toCsv(rows, refreshedAtIso) {
  const header = "zip,city,state,vertical,payoutFloor,pricingModel,isFlatRate,coverageZipCount,sourceRefreshedAt";
  const countByVertical = rows.reduce((acc, r) => {
    acc[r.vertical] = (acc[r.vertical] ?? 0) + 1;
    return acc;
  }, {});
  const lines = rows.map((r) =>
    [
      r.zip,
      r.city,
      r.state,
      r.vertical,
      r.payoutFloor,
      r.pricingModel,
      r.isFlatRate,
      countByVertical[r.vertical],
      refreshedAtIso,
    ].join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

// Fixed reference timestamps (not Date.now()) so the generated CSVs are
// byte-identical across re-runs, matching the deterministic PRNG above.
const V2_REFRESHED_AT = "2026-09-04T00:00:00.000Z";
const V1_REFRESHED_AT = "2026-07-17T00:00:00.000Z"; // ~7 weeks earlier

fs.writeFileSync(path.join(OUT_DIR, "coverage-v1-baseline.csv"), toCsv(v1Rows, V1_REFRESHED_AT));
fs.writeFileSync(path.join(OUT_DIR, "coverage-v2-current.csv"), toCsv(v2Rows, V2_REFRESHED_AT));

// --- Keyword metrics CSVs for BOTH imports, so the seed script can score
// v1 first and then v2, and demonstrate that MarketScore version numbers
// continue per MarketIdentity across the import boundary instead of
// resetting — that continuity is the whole point of the identity fix. ---
const kwHeader = "zip,vertical,keyword,searchVolume,keywordDifficulty,cpc";
function buildKeywordCsv(rows) {
  const lines = rows.map((r) => {
    const k = buildKeywordRow(r, VERTICALS[r.vertical]);
    return [k.zip, k.vertical, `"${k.keyword}"`, k.searchVolume, k.keywordDifficulty, k.cpc].join(",");
  });
  return { csv: [kwHeader, ...lines].join("\n") + "\n", count: lines.length };
}

const kwV1 = buildKeywordCsv(v1Rows);
const kwV2 = buildKeywordCsv(v2Rows);
fs.writeFileSync(path.join(OUT_DIR, "keyword-metrics-v1.csv"), kwV1.csv);
fs.writeFileSync(path.join(OUT_DIR, "keyword-metrics-v2.csv"), kwV2.csv);

console.log(
  `Wrote ${v1Rows.length} v1 rows, ${v2Rows.length} v2 rows, ${kwV1.count} v1 keyword rows, ${kwV2.count} v2 keyword rows to ${OUT_DIR}`
);
