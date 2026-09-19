import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { parseCsv } from "../csv";
import { SchemaDriftError, LocationFetchError, assertHttpOk } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

// Verified live (2026-09-06): real, current (2022-2023) IRS Statistics of
// Income county-to-county migration files — CSV, no auth required, no
// live query API (this is an annual static-file release, unlike every
// other adapter in this app). Real sample row confirms the shape below:
// "01,001,96,000,AL,Autauga County Total Migration-US and Foreign,2148,4413,138794"
//
// Two known, real (not bugs) sources of per-location LocationFetchError,
// confirmed live: (1) Puerto Rico (state FIPS 72) has essentially no rows
// in this file at all — PR residents largely don't file the same federal
// return this dataset is built from; (2) Connecticut's counties were
// replaced by new "Planning Region" FIPS codes (e.g. "09110" Capitol
// Planning Region) in this IRS release, while the Census 2020-vintage
// ZCTA-to-County crosswalk (Location.countyFips) still uses CT's legacy
// county FIPS — a real geography-vintage mismatch, not something to guess
// a fix for. Both surface as ordinary per-zip collection failures, caught
// by the Validator like any other gap.
// Năm thuế, lấy từ CHÍNH tên file IRS phát hành: "2223" = di chuyển giữa kỳ
// khai 2022 và 2023. Đổi file mà quên đổi đây thì hai thứ lệch nhau lặng lẽ,
// nên hằng số này là nguồn cho cả URL lẫn temporalCoverage.
const SOI_FROM_YEAR = 2022;
const SOI_TO_YEAR = 2023;
const SOI_SUFFIX = `${String(SOI_FROM_YEAR).slice(2)}${String(SOI_TO_YEAR).slice(2)}`;
const INFLOW_URL = `https://www.irs.gov/pub/irs-soi/countyinflow${SOI_SUFFIX}.csv`;
const OUTFLOW_URL = `https://www.irs.gov/pub/irs-soi/countyoutflow${SOI_SUFFIX}.csv`;

// Both files carry every origin/destination breakdown per county (same
// state, different state, foreign, ...) plus subtotals — "96" is IRS's
// special non-FIPS code for the "US and Foreign" grand-total aggregate row,
// confirmed live (real state FIPS never exceeds "56"). Only that one row
// per county is needed here — a single real "how many households moved
// in/out this year" number, not a breakdown this adapter doesn't use.
const TOTAL_MIGRATION_SUFFIX = "Total Migration-US and Foreign";

interface CountyMigrationData {
  inflowHouseholds: number | null;
  inflowAgiThousands: number | null;
  outflowHouseholds: number | null;
  outflowAgiThousands: number | null;
}

/**
 * IRS SOI county-to-county migration data — real households/income moving
 * in and out of each county per year. This is the exact data source
 * identified from the start for the moving-services niche
 * (lib/markets/candidate-niches.ts: "Gắn được dữ liệu di cư IRS/Census
 * theo county"). Structurally different from every other adapter here: an
 * annual static CSV release (no per-location query, no live API, no
 * token), and reported at COUNTY resolution — every zip within a county
 * gets that same county's numbers, marked isInferred:true/confidence 0.85
 * (lower than a direct zip-level source) via the schema's existing
 * geo-crosswalk fields, exactly what they were designed for.
 */
export class IrsMigrationAdapter implements CollectorAdapter {
  // Năm thuế lấy từ chính hậu tố tên file IRS.
  temporalCoverage = `${SOI_FROM_YEAR}-01-01/${SOI_TO_YEAR}-12-31`;
  adapterKey = "irs_migration";
  nativeGeoResolution = "COUNTY" as const;

  private dataPromise: Promise<Map<string, CountyMigrationData>> | null = null;

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    if (!location.countyFips) {
      throw new LocationFetchError(`No countyFips for zip ${location.zip} — cannot join IRS migration data without it`);
    }
    const data = await this.ensureData();
    const row = data.get(location.countyFips);
    if (!row) {
      throw new LocationFetchError(`No IRS migration data for county FIPS ${location.countyFips} (zip ${location.zip})`);
    }

    const points: CollectedDataPoint[] = [];
    const confidence = 0.85; // county-level source attributed to a zip within it — coarser than PVWatts/ACS5's direct zip-level data
    if (row.inflowHouseholds !== null) {
      points.push({ metric: "irs_migration_inflow_households", value: row.inflowHouseholds, unit: "households/yr", resolvedAtResolution: "COUNTY", isInferred: true, confidence });
    }
    if (row.outflowHouseholds !== null) {
      points.push({ metric: "irs_migration_outflow_households", value: row.outflowHouseholds, unit: "households/yr", resolvedAtResolution: "COUNTY", isInferred: true, confidence });
    }
    if (row.inflowHouseholds !== null && row.outflowHouseholds !== null) {
      points.push({
        metric: "irs_migration_net_households",
        value: row.inflowHouseholds - row.outflowHouseholds,
        unit: "households/yr",
        resolvedAtResolution: "COUNTY",
        isInferred: true,
        confidence,
      });
    }
    if (row.inflowAgiThousands !== null) {
      points.push({ metric: "irs_migration_inflow_agi_usd", value: row.inflowAgiThousands * 1000, unit: "USD/yr", resolvedAtResolution: "COUNTY", isInferred: true, confidence });
    }

    if (points.length === 0) {
      throw new LocationFetchError(`County FIPS ${location.countyFips} has no usable migration values (zip ${location.zip})`);
    }
    return points;
  }

  private async ensureData(): Promise<Map<string, CountyMigrationData>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, CountyMigrationData>> {
    const [inflow, outflow] = await Promise.all([
      this.fetchDirection(INFLOW_URL, "y2_statefips", "y2_countyfips", "y1_countyname"),
      this.fetchDirection(OUTFLOW_URL, "y1_statefips", "y1_countyfips", "y2_countyname"),
    ]);

    const result = new Map<string, CountyMigrationData>();
    const allCounties = new Set([...inflow.keys(), ...outflow.keys()]);
    for (const countyFips of allCounties) {
      result.set(countyFips, {
        inflowHouseholds: inflow.get(countyFips)?.households ?? null,
        inflowAgiThousands: inflow.get(countyFips)?.agiThousands ?? null,
        outflowHouseholds: outflow.get(countyFips)?.households ?? null,
        outflowAgiThousands: outflow.get(countyFips)?.agiThousands ?? null,
      });
    }
    return result;
  }

  /** Both files share the same column layout, just with the "county this
   * total is about" and "special aggregate code" sides swapped (see file
   * header comments above) — one parser handles both given which columns
   * to read for each. */
  private async fetchDirection(
    url: string,
    countyStateCol: string,
    countyCountyCol: string,
    countyNameCol: string
  ): Promise<Map<string, { households: number; agiThousands: number }>> {
    const { status, body } = await fetchWithCurlFallback(url);
    assertHttpOk(status, body, `IRS migration file request failed (${url})`, { unauthenticated: true });

    const text = body.toString("utf-8");
    /**
     * Bộ đọc CSV đúng chuẩn, cùng lý do với adapter FARS.
     *
     * Ở đây rủi ro còn rõ hơn: adapter này đọc cột TÊN HẠT, và tên hạt là chỗ
     * dấu phẩy xuất hiện tự nhiên nhất trong một file của cơ quan liên bang.
     * Một tên có dấu phẩy sẽ đẩy `n1` và `agi` sang cột khác — và cả hai đều
     * là số, nên chúng nhận một giá trị có thật của cột bên cạnh và trông
     * hoàn toàn bình thường.
     */
    const rows = parseCsv(text);
    if (rows.length === 0) {
      throw new SchemaDriftError(`IRS migration file (${url}) was empty.`);
    }
    const header = rows[0].map((h) => h.trim());
    const stateIdx = header.indexOf(countyStateCol);
    const countyIdx = header.indexOf(countyCountyCol);
    const nameIdx = header.indexOf(countyNameCol);
    const n1Idx = header.indexOf("n1");
    const agiIdx = header.indexOf("agi");
    if ([stateIdx, countyIdx, nameIdx, n1Idx, agiIdx].includes(-1)) {
      throw new SchemaDriftError(`IRS migration file (${url}) missing an expected column. Columns received: ${header.join(", ")}.`);
    }

    const result = new Map<string, { households: number; agiThousands: number }>();
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const name = cols[nameIdx];
      if (!name || !name.endsWith(TOTAL_MIGRATION_SUFFIX)) continue; // only the one aggregate row per county

      const stateFips = cols[stateIdx];
      const countyFips = cols[countyIdx];
      if (!stateFips || !countyFips) continue;
      const fullCountyFips = `${stateFips}${countyFips}`;

      const households = Number(cols[n1Idx]);
      const agiThousands = Number(cols[agiIdx]);
      if (!Number.isFinite(households) || !Number.isFinite(agiThousands)) continue;

      result.set(fullCountyFips, { households, agiThousands });
    }
    return result;
  }
}
