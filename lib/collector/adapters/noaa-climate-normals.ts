import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

const NOAA_BASE_URL = "https://www.ncei.noaa.gov/cdo-web/api/v2/data";

// NORMAL_MLY (1991-2020 monthly climate normals) indexes its 12 monthly
// rows under a fixed placeholder year — NOAA's own CDO API documentation
// examples query monthly-normals datasets with startdate=2010-01-01 /
// enddate=2010-12-01 regardless of which real 30-year normals period is
// being served. NOT independently confirmed against a live response — see
// the adapter docstring below.
const NORMAL_PERIOD_START = "2010-01-01";
const NORMAL_PERIOD_END = "2010-12-01";

const DATATYPES = {
  heatingDegreeDays: "MLY-HTDD-NORMAL",
  coolingDegreeDays: "MLY-CLDD-NORMAL",
  precipitation: "MLY-PRCP-NORMAL",
} as const;

interface NoaaResultRow {
  date: string;
  datatype: string;
  value: number;
}

/**
 * NOAA Climate Data Online (CDO) API v2 — 1991-2020 monthly climate
 * normals (heating/cooling degree days, precipitation), per zip.
 *
 * IMPORTANT — unverified against a live call: NOAA requires a real
 * NOAA_API_TOKEN even to hit its metadata/discovery endpoints (confirmed
 * live, 2026-09-06: a fake token gets a real
 * `400 {"status":"400","message":"The token parameter provided is not valid."}`
 * — there is no way to check the actual request/response shape without a
 * genuine token). Everything below is built from NOAA's own published CDO
 * API v2 documentation, not a live response:
 *   - auth: the `token` HTTP header (NOT a query param, NOT Bearer)
 *   - GET .../data?datasetid=NORMAL_MLY&locationid=ZIP:{zip}&datatypeid=...
 *     (repeated once per datatype)&startdate=...&enddate=...&units=standard&limit=1000
 *   - response: { results: [{ date, datatype, station, attributes, value }], metadata: {...} }
 *
 * Two things are explicitly *not* confirmed and are the most likely schema-
 * drift risks the first time this actually runs against a real token:
 *   1. The exact anchor dates NORMAL_MLY uses to represent "which month" —
 *      assumed to be the documented 2010-01-01..2010-12-01 placeholder year.
 *   2. Whether `units=standard` fully normalizes precipitation scaling
 *      (some NOAA datasets report precipitation pre-scaled, e.g. tenths of
 *      a unit, depending on dataset/source).
 * A single ZIP can resolve to more than one nearby station, so values are
 * averaged across stations per month before being summed into an annual
 * figure. The schema-drift guard (missing/retyped fields) is the safety
 * net if either assumption above turns out wrong — same "ship it, verify
 * for real once a credential exists" approach this codebase already used
 * for the original PVWatts and GSC adapters.
 */
export class NoaaClimateNormalsAdapter implements CollectorAdapter {
  adapterKey = "noaa_climate_normals";
  nativeGeoResolution = "ZIP" as const;

  constructor(private readonly apiToken: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    const params = new URLSearchParams({
      datasetid: "NORMAL_MLY",
      locationid: `ZIP:${location.zip}`,
      startdate: NORMAL_PERIOD_START,
      enddate: NORMAL_PERIOD_END,
      units: "standard",
      limit: "1000",
    });
    for (const datatypeId of Object.values(DATATYPES)) {
      params.append("datatypeid", datatypeId);
    }

    const { status, body } = await fetchWithCurlFallback(`${NOAA_BASE_URL}?${params.toString()}`, {
      token: this.apiToken,
    });

    if (status === 404) {
      // Documented CDO API behavior: a locationid with zero matching
      // stations returns 404, not an empty 200 result set.
      throw new LocationFetchError(`No NOAA station data for zip ${location.zip} (404 — likely no nearby station)`);
    }
    if (status !== 200) {
      throw new LocationFetchError(`NOAA request failed for zip ${location.zip}: HTTP ${status}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError(`NOAA response for zip ${location.zip} was not valid JSON.`);
    }

    const results = (parsed as Record<string, unknown>)?.results;
    if (results === undefined) {
      throw new SchemaDriftError(`NOAA response for zip ${location.zip} had no "results" field — envelope may have changed.`);
    }
    if (!Array.isArray(results) || results.length === 0) {
      throw new LocationFetchError(`NOAA returned zero normals rows for zip ${location.zip}`);
    }

    const rows: NoaaResultRow[] = [];
    for (const r of results) {
      const row = r as Record<string, unknown>;
      if (typeof row.date !== "string" || typeof row.datatype !== "string" || typeof row.value !== "number") {
        throw new SchemaDriftError(`NOAA result row for zip ${location.zip} missing/retyped date, datatype, or value.`);
      }
      rows.push({ date: row.date, datatype: row.datatype, value: row.value });
    }

    // Sum 12 cross-station-averaged monthly values into one annual figure per datatype.
    const annualTotals = new Map<string, number>();
    for (const datatypeId of Object.values(DATATYPES)) {
      const byMonth = new Map<string, number[]>();
      for (const row of rows) {
        if (row.datatype !== datatypeId) continue;
        const month = row.date.slice(0, 7); // "2010-01"
        if (!byMonth.has(month)) byMonth.set(month, []);
        byMonth.get(month)!.push(row.value);
      }
      if (byMonth.size === 0) continue;
      let total = 0;
      for (const monthValues of byMonth.values()) {
        total += monthValues.reduce((a, b) => a + b, 0) / monthValues.length;
      }
      annualTotals.set(datatypeId, total);
    }

    const points: CollectedDataPoint[] = [];
    const confidence = 0.85; // averaged across possibly-multiple nearby stations, not a single direct reading

    const htdd = annualTotals.get(DATATYPES.heatingDegreeDays);
    if (htdd !== undefined) {
      points.push({ metric: "noaa_heating_degree_days_annual", value: htdd, unit: "degree-days/yr", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }
    const cldd = annualTotals.get(DATATYPES.coolingDegreeDays);
    if (cldd !== undefined) {
      points.push({ metric: "noaa_cooling_degree_days_annual", value: cldd, unit: "degree-days/yr", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }
    const prcp = annualTotals.get(DATATYPES.precipitation);
    if (prcp !== undefined) {
      points.push({ metric: "noaa_precipitation_annual", value: prcp, unit: "in/yr", resolvedAtResolution: "ZIP", isInferred: false, confidence });
    }

    if (points.length === 0) {
      throw new LocationFetchError(`NOAA returned rows for zip ${location.zip} but none matched the expected datatypes.`);
    }
    return points;
  }
}
