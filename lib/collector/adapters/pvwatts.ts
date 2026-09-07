import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError } from "../errors";

// The lab formerly known as NREL (National Renewable Energy Laboratory)
// renamed to NLR (National Laboratory of the Rockies); developer.nrel.gov
// was fully retired 2026-05-29 in favor of developer.nlr.gov — confirmed
// live (2026-09-05): developer.nlr.gov/signup/ returns 200, and this exact
// path returns a real 403 (not a DNS failure or 404) without an API key.
// Existing NREL_API_KEY values keep working; only the host changed.
const PVWATTS_BASE_URL = "https://developer.nlr.gov/api/pvwatts/v8.json";

// Confirmed live (2026-09-05): the "address" param this adapter used to
// send is dead — NLR/NREL removed it entirely (email notice sent to API
// users 2025-02-25) and now returns a hard error telling callers to pass
// lat/lon instead: {"errors":["The 'address' parameter is no longer
// supported. Pass in the 'lat' and 'lon' parameters instead. ..."]}.
// lat/lon with real values (Census Gazetteer ZCTA centroid, see
// scripts/generate-locations-from-census.ts) was verified to return real
// outputs.{ac_annual,solrad_annual,capacity_factor} for a real zip.

/**
 * Reference residential system used for every location, so the resulting
 * numbers are comparable market-to-market — we're measuring "how good is
 * the sun here for a typical roof-mounted system," not sizing a real
 * customer's system. Fixed on purpose; don't vary these per request.
 */
const REFERENCE_SYSTEM = {
  system_capacity: 4, // kW DC — small residential reference system
  module_type: 1, // standard
  array_type: 1, // fixed, roof mount — most common residential install
  losses: 14, // NREL's documented typical system loss %
  tilt: 20, // degrees — typical roof pitch
  azimuth: 180, // degrees — south-facing (best case, Northern Hemisphere)
};

/**
 * NLR (formerly NREL) PVWatts v8 adapter, keyed by NREL_API_KEY.
 *
 * IMPORTANT — still unverified against a live call: at the time
 * developer.nrel.gov stopped resolving, that was a DNS failure specific to
 * that host (4 independent public resolvers, every other .gov API host
 * tried resolved fine) — later found to be because the host was retired,
 * not a transient outage (see PVWATTS_BASE_URL above). The new
 * developer.nlr.gov host is confirmed live, but this adapter's actual
 * request/response handling below is still written from the documented v8
 * contract, not a real authenticated call. Before trusting this in
 * production, run it once against a real zip and confirm
 * `outputs.ac_annual` / `outputs.solrad_annual` / `outputs.capacity_factor`
 * actually come back in the shape assumed below. If NLR has changed the
 * response envelope, the schema-drift check should catch it (SUSPECT
 * snapshot) rather than silently writing wrong numbers — but that check is
 * only as good as this file's assumptions.
 */
export class PvWattsAdapter implements CollectorAdapter {
  adapterKey = "nrel_pvwatts";
  nativeGeoResolution = "ZIP" as const;

  constructor(private readonly apiKey: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    if (location.lat === null || location.lon === null) {
      throw new LocationFetchError(
        `No lat/lon for zip ${location.zip} — PVWatts requires real coordinates (the "address" param was removed by NLR/NREL). ` +
          "Re-run scripts/generate-locations-from-census.ts to populate lat/lon from the Census Gazetteer file."
      );
    }

    const params = new URLSearchParams({
      api_key: this.apiKey,
      lat: String(location.lat),
      lon: String(location.lon),
      system_capacity: String(REFERENCE_SYSTEM.system_capacity),
      module_type: String(REFERENCE_SYSTEM.module_type),
      array_type: String(REFERENCE_SYSTEM.array_type),
      losses: String(REFERENCE_SYSTEM.losses),
      tilt: String(REFERENCE_SYSTEM.tilt),
      azimuth: String(REFERENCE_SYSTEM.azimuth),
      timeframe: "monthly",
    });

    const response = await fetch(`${PVWATTS_BASE_URL}?${params.toString()}`);

    if (!response.ok) {
      // 4xx/5xx at the HTTP level — treat as a per-location transient
      // failure (bad key would fail every location identically, which will
      // show up as a 100% failure rate rather than a silent gap).
      throw new LocationFetchError(`PVWatts HTTP ${response.status} for zip ${location.zip}`);
    }

    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
      throw new SchemaDriftError(`PVWatts response for zip ${location.zip} was not a JSON object`);
    }
    const parsed = body as Record<string, unknown>;

    const errors = parsed.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      throw new LocationFetchError(`PVWatts error for zip ${location.zip}: ${errors.join("; ")}`);
    }

    const outputs = parsed.outputs;
    if (typeof outputs !== "object" || outputs === null) {
      throw new SchemaDriftError(
        `PVWatts response for zip ${location.zip} had no "outputs" object and no errors — response envelope may have changed`
      );
    }
    const o = outputs as Record<string, unknown>;

    if (typeof o.ac_annual !== "number" || typeof o.solrad_annual !== "number" || typeof o.capacity_factor !== "number") {
      throw new SchemaDriftError(
        `PVWatts outputs for zip ${location.zip} missing/retyped one of ac_annual, solrad_annual, capacity_factor`
      );
    }

    // A geocoded address hit, not inferred from a coarser geography — but
    // still a modeled satellite/TMY estimate for the nearest weather
    // station, not a direct on-site measurement, hence < 1.0.
    const confidence = 0.9;

    return [
      { metric: "solar_ac_annual_kwh", value: o.ac_annual, unit: "kWh/yr", resolvedAtResolution: "ZIP", isInferred: false, confidence },
      { metric: "solar_radiation_avg_kwh_per_m2_day", value: o.solrad_annual, unit: "kWh/m2/day", resolvedAtResolution: "ZIP", isInferred: false, confidence },
      { metric: "solar_capacity_factor_pct", value: o.capacity_factor, unit: "%", resolvedAtResolution: "ZIP", isInferred: false, confidence },
    ];
  }
}
