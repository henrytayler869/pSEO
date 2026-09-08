import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError, assertHttpOk } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

const ACS_YEAR = 2023;

// ACS table B07003 — "Geographic Mobility in the Past Year by Sex for
// Current Residence". Verified live 2026-09-07 at ZCTA resolution: the four
// "moved" components plus "same house" sum EXACTLY to the total on every
// zip tested (11212: 78,061+6,086+2,116+572+418 = 87,253 = total; same for
// 60639 and 78245), which confirms these are the mutually-exclusive
// category totals and not a subset.
//
// Why this source matters for moving-services specifically: it is the only
// dataset here that measures the act of moving AT ZIP RESOLUTION.
// irs_migration describes real household flows but only per COUNTY, so
// every zip in a county gets an identical, inferred figure — which is
// exactly what makes pages for zips in the same county read alike. Measured
// on the 9-zip Brooklyn sample (2026-09-07), this table spreads 7.32x on
// mobility rate and 30.28x on out-of-state arrivals across zips that share
// a county, versus 3.05x (home value), 4.51x (income) and 1.01x (year
// built) for the housing table. It is simultaneously the strongest
// per-zip differentiator available and the most on-topic one.
const VARIABLES = {
  total: "B07003_001E",
  sameHouse: "B07003_004E",
  movedWithinCounty: "B07003_007E",
  movedFromDifferentCounty: "B07003_010E",
  movedFromDifferentState: "B07003_013E",
  movedFromAbroad: "B07003_016E",
};

const SUPPRESSED_VALUE = -666666666; // Census's "can't produce a reliable estimate" sentinel — not a real value

interface ZctaMobility {
  movedWithinCounty: number | null;
  movedFromDifferentCounty: number | null;
  movedFromDifferentState: number | null;
  movedFromAbroad: number | null;
  mobilityRatePct: number | null;
}

/**
 * Census ACS5 geographic-mobility counts per real zip (ZCTA). Same bulk
 * "one nationwide call, cached for the whole run" shape as
 * census-acs-housing.ts — ACS5 returns every ZCTA in a single response, so
 * fetching per zip would re-download the country for each location.
 */
export class CensusMobilityAdapter implements CollectorAdapter {
  adapterKey = "census_mobility";
  nativeGeoResolution = "ZIP" as const;

  private dataPromise: Promise<Map<string, ZctaMobility>> | null = null;

  constructor(private readonly apiKey: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    const data = await this.ensureData();
    const row = data.get(location.zip);
    if (!row) {
      throw new LocationFetchError(`No Census B07003 row returned for zip ${location.zip}`);
    }

    const points: CollectedDataPoint[] = [];
    // Same confidence as the housing table: ACS5 is a modeled 5-year survey
    // estimate, not a direct count — but it IS reported for this zip, so
    // nothing is inferred from a coarser geography.
    const confidence = 0.9;
    const push = (metric: string, value: number | null, unit: string) => {
      if (value === null) return;
      points.push({ metric, value, unit, resolvedAtResolution: "ZIP", isInferred: false, confidence });
    };

    push("census_moved_within_county", row.movedWithinCounty, "people/yr");
    push("census_moved_from_different_county", row.movedFromDifferentCounty, "people/yr");
    push("census_moved_from_different_state", row.movedFromDifferentState, "people/yr");
    push("census_moved_from_abroad", row.movedFromAbroad, "people/yr");
    push("census_mobility_rate_pct", row.mobilityRatePct, "%");

    if (points.length === 0) {
      throw new LocationFetchError(
        `Every B07003 value is suppressed/unavailable for zip ${location.zip} — small-population ZCTA, not a real error`
      );
    }
    return points;
  }

  private async ensureData(): Promise<Map<string, ZctaMobility>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, ZctaMobility>> {
    const varList = Object.values(VARIABLES).join(",");
    const url =
      `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=NAME,${varList}` +
      `&for=zip%20code%20tabulation%20area:*&key=${this.apiKey}`;

    const { status, body } = await fetchWithCurlFallback(url);
    assertHttpOk(status, body, "Census B07003 request failed");

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError("Census B07003 response was not valid JSON.");
    }
    if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[0])) {
      throw new SchemaDriftError("Census B07003 response was not the expected [header, ...rows] array shape.");
    }

    const header = parsed[0] as string[];
    const zctaIdx = header.findIndex((h) => h.toLowerCase().includes("zip"));
    const idx = Object.fromEntries(
      Object.entries(VARIABLES).map(([k, v]) => [k, header.indexOf(v)])
    ) as Record<keyof typeof VARIABLES, number>;
    if (zctaIdx === -1 || Object.values(idx).includes(-1)) {
      throw new SchemaDriftError(`Census B07003 response missing an expected column. Columns received: ${header.join(", ")}.`);
    }

    const rows = parsed.slice(1) as string[][];
    const result = new Map<string, ZctaMobility>();
    for (const r of rows) {
      const total = parseAcsValue(r[idx.total]);
      const sameHouse = parseAcsValue(r[idx.sameHouse]);
      result.set(r[zctaIdx], {
        movedWithinCounty: parseAcsValue(r[idx.movedWithinCounty]),
        movedFromDifferentCounty: parseAcsValue(r[idx.movedFromDifferentCounty]),
        movedFromDifferentState: parseAcsValue(r[idx.movedFromDifferentState]),
        movedFromAbroad: parseAcsValue(r[idx.movedFromAbroad]),
        // Share of residents who lived somewhere else a year ago. Derived
        // from two measured counts, not modelled — and only when the
        // denominator is real, since a 0-population ZCTA would otherwise
        // produce a divide-by-zero rather than an honest "no data".
        mobilityRatePct:
          total !== null && sameHouse !== null && total > 0 ? ((total - sameHouse) / total) * 100 : null,
      });
    }
    return result;
  }
}

function parseAcsValue(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === SUPPRESSED_VALUE || n < 0) return null;
  return n;
}
