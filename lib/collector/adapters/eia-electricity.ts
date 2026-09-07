import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

/**
 * EIA Open Data API v2 — residential retail electricity price, per state.
 * Shape confirmed against EIA's own published API documentation
 * (api.eia.gov/v2/electricity/retail-sales — sectorid RES, frequency
 * annual), NOT yet verified against a live call — no real EIA_API_KEY
 * exists yet in this environment (user will register at eia.gov/opendata
 * and enter it in Settings later). Same "unverified pending real
 * credential" status the original PVWatts/GSC adapters shipped with.
 *
 * Bulk endpoint (all states, one call) — same lazy-cache pattern as
 * census-acs-housing.ts, not a per-zip call like PVWatts. `stateid` in the
 * response is the 2-letter postal code, which matches Location.state
 * directly — no crosswalk needed.
 */
export class EiaElectricityAdapter implements CollectorAdapter {
  adapterKey = "eia_electricity";
  nativeGeoResolution = "STATE" as const;

  private dataPromise: Promise<Map<string, number>> | null = null;

  constructor(private readonly apiKey: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    const data = await this.ensureData();
    const priceCentsPerKwh = data.get(location.state);
    if (priceCentsPerKwh === undefined) {
      throw new LocationFetchError(`No EIA residential electricity price for state ${location.state} (zip ${location.zip})`);
    }
    return [
      {
        metric: "eia_residential_electricity_price_cents_per_kwh",
        value: priceCentsPerKwh,
        unit: "cents/kWh",
        resolvedAtResolution: "STATE",
        isInferred: true, // state-level figure attributed to every zip in that state
        confidence: 0.9,
      },
    ];
  }

  private async ensureData(): Promise<Map<string, number>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, number>> {
    const url =
      "https://api.eia.gov/v2/electricity/retail-sales/data/" +
      `?api_key=${encodeURIComponent(this.apiKey)}` +
      "&frequency=annual&data[]=price&facets[sectorid][]=RES" +
      "&sort[0][column]=period&sort[0][direction]=desc&length=5000";

    const { status, body } = await fetchWithCurlFallback(url);
    if (status !== 200) {
      throw new SchemaDriftError(`EIA request failed: HTTP ${status}. Body: ${body.toString("utf-8").slice(0, 300)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError("EIA response was not valid JSON.");
    }

    const rows = (parsed as { response?: { data?: unknown } })?.response?.data;
    if (!Array.isArray(rows)) {
      throw new SchemaDriftError("EIA response missing response.data array (schema drift).");
    }

    // Sorted desc by period, so the first row seen per state is the latest.
    const result = new Map<string, number>();
    for (const row of rows) {
      const stateid = (row as { stateid?: unknown }).stateid;
      const price = Number((row as { price?: unknown }).price);
      if (typeof stateid !== "string" || !Number.isFinite(price)) continue;
      if (!result.has(stateid)) result.set(stateid, price);
    }
    if (result.size === 0) {
      throw new SchemaDriftError("EIA response parsed but yielded zero valid state prices (schema drift).");
    }
    return result;
  }
}
