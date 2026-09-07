import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";

/**
 * NOT a real data source. Used whenever NREL_API_KEY isn't configured
 * (ALLOW_PVWATTS_MOCK=true) — generates plausible-shaped solar numbers
 * purely to exercise the Collector -> Validator pipeline end-to-end. It
 * deliberately seeds a handful of pathological cases (an outlier, a couple
 * of schema-drift-triggering zips) so the Validator's rules have something
 * real to catch. Swap to PvWattsAdapter (pvwatts.ts) once you have an
 * NREL_API_KEY configured — do not ship this to anything real. (Originally
 * written because this session's sandbox couldn't resolve
 * developer.nrel.gov at all; later confirmed that host was retired
 * 2026-05-29, not just unreachable — see pvwatts.ts.)
 */
export class PvWattsMockAdapter implements CollectorAdapter {
  adapterKey = "nrel_pvwatts";
  nativeGeoResolution = "ZIP" as const;

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    const seed = hashString(location.zip);
    const rand = mulberry32(seed);

    // A handful of zips (deterministic by zip hash) simulate real-world
    // collector failure modes instead of every call succeeding identically.
    const bucket = seed % 97;
    if (bucket === 0) {
      throw new Error(`mock: simulated transient network error for zip ${location.zip}`);
    }

    const baseSolrad = 4.2 + rand() * 2.3; // ~4.2-6.5 kWh/m2/day, realistic continental-US range
    const isOutlier = bucket === 1; // force one clear outlier for the Validator demo
    const solradAnnual = isOutlier ? baseSolrad * 4.2 : baseSolrad;
    const capacityFactor = 12 + rand() * 12; // ~12-24%
    const acAnnual = solradAnnual * REFERENCE_KWH_PER_SOLRAD_UNIT * (1 + rand() * 0.1);

    const confidence = 0.9;
    return [
      { metric: "solar_ac_annual_kwh", value: round(acAnnual), unit: "kWh/yr", resolvedAtResolution: "ZIP", isInferred: false, confidence },
      { metric: "solar_radiation_avg_kwh_per_m2_day", value: round(solradAnnual), unit: "kWh/m2/day", resolvedAtResolution: "ZIP", isInferred: false, confidence },
      { metric: "solar_capacity_factor_pct", value: round(capacityFactor), unit: "%", resolvedAtResolution: "ZIP", isInferred: false, confidence },
    ];
  }
}

const REFERENCE_KWH_PER_SOLRAD_UNIT = 950; // rough scaling so ac_annual tracks solrad plausibly for a 4kW system

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function mulberry32(seed: number) {
  let state = seed;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
