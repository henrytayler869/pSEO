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
 *   - GET .../data?datasetid=NORMAL_MLY&locationid=FIPS:{countyFips}&datatypeid=...
 *     (KHÔNG phải ZIP: — dataset này không có station nào ánh xạ cho kiểu ZIP)
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
  // COUNTY, not ZIP — see the note on fetchOne. The dataset simply has no
  // station mapping for ZIP-type locations, so claiming ZIP resolution here
  // would be a claim the data cannot support.
  nativeGeoResolution = "COUNTY" as const;

  constructor(private readonly apiToken: string) {}

  /** One request per COUNTY, not per zip.
   *
   * Many zips share a county, so querying per zip would repeat the identical
   * request dozens of times against an API that caps at 5 requests/second and
   * is already the one source this project throttles. */
  private readonly byCounty = new Map<string, Promise<CollectedDataPoint[]>>();

  /**
   * Queried by county FIPS because NORMAL_MLY has no ZIP mapping AT ALL.
   *
   * This adapter shipped querying `ZIP:{zip}` and returned nothing, for every
   * zip, always. The VPS session proved why: CDO reports zero stations for the
   * pair (NORMAL_MLY, ZIP) — `/stations?datasetid=NORMAL_MLY&locationid=ZIP:77584`
   * comes back empty. Not a bad zip, not sparse coverage; that location type is
   * not mapped to this dataset. `FIPS:48039` for the same place returns 60 rows.
   *
   * The trade-off is real and is disclosed rather than buried: county normals
   * are COARSER than zip normals would have been. For climate that is nearly
   * always fine — heating and cooling degree days do not change much across one
   * county — but every point is written with resolvedAtResolution COUNTY and
   * isInferred true, so any consumer that attributes it to a zip is doing so
   * knowingly. That matters most for the AI layer, which refuses to write "in
   * ZIP 12345" about a county-scoped figure.
   *
   * Consequence to expect: zips sharing a county carry identical values. That
   * is correct, not duplication — the outlier rule compares against a
   * leave-one-out mean, so identical neighbours make a flag LESS likely, not
   * more.
   */
  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    if (!location.countyFips) {
      throw new LocationFetchError(
        `Không có countyFips cho zip ${location.zip} — NOAA NORMAL_MLY chỉ truy vấn được theo hạt, không theo zip.`
      );
    }
    const cached = this.byCounty.get(location.countyFips);
    if (cached) return cached;
    const pending = this.fetchCounty(location.countyFips);
    this.byCounty.set(location.countyFips, pending);
    return pending;
  }

  private async fetchCounty(countyFips: string): Promise<CollectedDataPoint[]> {
    const params = new URLSearchParams({
      datasetid: "NORMAL_MLY",
      locationid: `FIPS:${countyFips}`,
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
      throw new LocationFetchError(`Không có dữ liệu NOAA cho hạt ${countyFips} (404 — có thể không có trạm gần)`);
    }
    if (status !== 200) {
      throw new LocationFetchError(`Gọi NOAA thất bại cho hạt ${countyFips}: HTTP ${status}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError(`Phản hồi NOAA cho hạt ${countyFips} không phải JSON hợp lệ.`);
    }

    const envelope = (parsed ?? {}) as Record<string, unknown>;
    const results = envelope.results;

    // `{}` is how CDO says "no matching records" — it does NOT return
    // `{"results": []}`. Reading that as a changed envelope is wrong, and it
    // was: this adapter reported "envelope may have changed" while the
    // envelope was entirely normal, sending whoever debugged it looking for a
    // schema change that had not happened.
    //
    // The distinction that matters: a body with NO keys is an empty result. A
    // body with keys but no `results` is a shape that really did change.
    if (results === undefined) {
      if (Object.keys(envelope).length === 0) {
        throw new LocationFetchError(
          `NOAA không có bản ghi nào cho hạt ${countyFips} (phản hồi {} — truy vấn rỗng, KHÔNG phải đổi envelope)`
        );
      }
      throw new SchemaDriftError(
        `Phản hồi NOAA cho hạt ${countyFips} thiếu trường "results" nhưng có các trường khác (${Object.keys(envelope).join(", ")}) — envelope có thể đã đổi thật.`
      );
    }
    if (!Array.isArray(results) || results.length === 0) {
      throw new LocationFetchError(`NOAA trả về 0 dòng normals cho hạt ${countyFips}`);
    }

    const rows: NoaaResultRow[] = [];
    for (const r of results) {
      const row = r as Record<string, unknown>;
      if (typeof row.date !== "string" || typeof row.datatype !== "string" || typeof row.value !== "number") {
        throw new SchemaDriftError(`Dòng kết quả NOAA của hạt ${countyFips} thiếu hoặc sai kiểu date/datatype/value.`);
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
    // Lower than the 0.85 this used when it claimed ZIP resolution: the figure
    // is now averaged across stations in a whole county and attributed down to
    // each zip in it, which is one more inference than before.
    const confidence = 0.75;

    const htdd = annualTotals.get(DATATYPES.heatingDegreeDays);
    if (htdd !== undefined) {
      points.push({ metric: "noaa_heating_degree_days_annual", value: htdd, unit: "degree-days/yr", resolvedAtResolution: "COUNTY", isInferred: true, confidence });
    }
    const cldd = annualTotals.get(DATATYPES.coolingDegreeDays);
    if (cldd !== undefined) {
      points.push({ metric: "noaa_cooling_degree_days_annual", value: cldd, unit: "degree-days/yr", resolvedAtResolution: "COUNTY", isInferred: true, confidence });
    }
    const prcp = annualTotals.get(DATATYPES.precipitation);
    if (prcp !== undefined) {
      points.push({ metric: "noaa_precipitation_annual", value: prcp, unit: "in/yr", resolvedAtResolution: "COUNTY", isInferred: true, confidence });
    }

    if (points.length === 0) {
      throw new LocationFetchError(`NOAA trả về dữ liệu cho hạt ${countyFips} nhưng không dòng nào khớp datatype mong đợi.`);
    }
    return points;
  }
}
