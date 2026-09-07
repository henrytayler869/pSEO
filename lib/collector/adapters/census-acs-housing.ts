import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

const ACS_YEAR = 2023;
// Verified live (2026-09-06) with a real CENSUS_API_KEY against real zips —
// e.g. 77494 (Katy, TX): home value $450,100, household income $146,105,
// median year built 2011 (matches — Katy is a newer suburb), 71% owner-occupied.
// Same variable family, same "zip code tabulation area" geography already
// used for population in scripts/generate-locations-from-census.ts.
const VARIABLES = {
  medianHomeValue: "B25077_001E",
  medianHouseholdIncome: "B19013_001E",
  medianYearBuilt: "B25035_001E",
  totalOccupiedUnits: "B25003_001E",
  ownerOccupiedUnits: "B25003_002E",
};
const SUPPRESSED_VALUE = -666666666; // Census's sentinel for "can't produce a reliable estimate" — not a real value

interface ZctaHousingData {
  medianHomeValue: number | null;
  medianHouseholdIncome: number | null;
  medianYearBuilt: number | null;
  homeownershipRatePct: number | null;
}

/**
 * Census ACS5 housing/income variables, per real zip (ZCTA) — a genuine
 * extension of the exact API this app already uses for population
 * (scripts/generate-locations-from-census.ts), not a new integration from
 * scratch. Unlike PVWatts (one HTTP call per zip), ACS5 returns every ZCTA
 * nationwide in a single bulk response, so this adapter fetches once (cached
 * across the whole collection run, even under concurrency — see
 * ensureData()) and serves each location's fetchOne() from that cache,
 * rather than re-fetching the entire nationwide dataset per zip.
 */
export class CensusAcsHousingAdapter implements CollectorAdapter {
  adapterKey = "census_acs_housing";
  nativeGeoResolution = "ZIP" as const;

  private dataPromise: Promise<Map<string, ZctaHousingData>> | null = null;

  constructor(private readonly apiKey: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    const data = await this.ensureData();
    const row = data.get(location.zip);
    if (!row) {
      throw new LocationFetchError(`No Census ACS5 row returned for zip ${location.zip}`);
    }

    const points: CollectedDataPoint[] = [];
    const confidence = 0.9; // ACS5 is a modeled 5-year survey estimate, not a direct count — same confidence PVWatts uses for its modeled estimate
    if (row.medianHomeValue !== null) {
      points.push({ metric: "census_median_home_value_usd", value: row.medianHomeValue, unit: "USD", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }
    if (row.medianHouseholdIncome !== null) {
      points.push({ metric: "census_median_household_income_usd", value: row.medianHouseholdIncome, unit: "USD", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }
    if (row.medianYearBuilt !== null) {
      points.push({ metric: "census_median_year_built", value: row.medianYearBuilt, unit: "year", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }
    if (row.homeownershipRatePct !== null) {
      points.push({ metric: "census_homeownership_rate_pct", value: row.homeownershipRatePct, unit: "%", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }

    if (points.length === 0) {
      throw new LocationFetchError(`Every ACS5 variable is suppressed/unavailable for zip ${location.zip} — small-population ZCTA, not a real error`);
    }
    return points;
  }

  private async ensureData(): Promise<Map<string, ZctaHousingData>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, ZctaHousingData>> {
    const varList = Object.values(VARIABLES).join(",");
    const url =
      `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=NAME,${varList}` +
      `&for=zip%20code%20tabulation%20area:*&key=${this.apiKey}`;

    const { status, body } = await fetchWithCurlFallback(url);
    if (status !== 200) {
      throw new SchemaDriftError(`Census ACS5 request failed: HTTP ${status}.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError("Census ACS5 response was not valid JSON.");
    }
    if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[0])) {
      throw new SchemaDriftError("Census ACS5 response was not the expected [header, ...rows] array shape.");
    }

    const header = parsed[0] as string[];
    const zctaIdx = header.findIndex((h) => h.toLowerCase().includes("zip"));
    const homeValueIdx = header.indexOf(VARIABLES.medianHomeValue);
    const incomeIdx = header.indexOf(VARIABLES.medianHouseholdIncome);
    const yearBuiltIdx = header.indexOf(VARIABLES.medianYearBuilt);
    const totalOccupiedIdx = header.indexOf(VARIABLES.totalOccupiedUnits);
    const ownerOccupiedIdx = header.indexOf(VARIABLES.ownerOccupiedUnits);
    if ([zctaIdx, homeValueIdx, incomeIdx, yearBuiltIdx, totalOccupiedIdx, ownerOccupiedIdx].includes(-1)) {
      throw new SchemaDriftError(`Census ACS5 response missing an expected column. Columns received: ${header.join(", ")}.`);
    }

    const rows = parsed.slice(1) as string[][];
    const result = new Map<string, ZctaHousingData>();
    for (const r of rows) {
      const zip = r[zctaIdx];
      const totalOccupied = parseAcsValue(r[totalOccupiedIdx]);
      const ownerOccupied = parseAcsValue(r[ownerOccupiedIdx]);
      result.set(zip, {
        medianHomeValue: parseAcsValue(r[homeValueIdx]),
        medianHouseholdIncome: parseAcsValue(r[incomeIdx]),
        medianYearBuilt: parseAcsValue(r[yearBuiltIdx]),
        homeownershipRatePct:
          totalOccupied !== null && ownerOccupied !== null && totalOccupied > 0 ? (ownerOccupied / totalOccupied) * 100 : null,
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
