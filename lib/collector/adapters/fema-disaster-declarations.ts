import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError, assertHttpOk } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

const FEMA_BASE_URL = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
const LOOKBACK_YEARS = 10;

// Verified live (2026-09-06), no API key required: fetching all 25,065 US
// declarations since 2016-01-01 in one $top-overridden call (OpenFEMA
// doesn't hard-cap $top the way the docs' default-1000 example implies —
// tested up to 30,000 rows returned in a single response) returns the
// exact { metadata: { count }, DisasterDeclarationsSummaries: [...] }
// envelope assumed below, with fipsStateCode/fipsCountyCode/incidentType/
// declarationDate/disasterNumber all present as plain strings/ISO dates.
//
// Real, load-bearing finding from that same live pull: "Biological" is by
// far the single largest incidentType (7,857 of 25,065 rows) — these are
// the nationwide COVID-19 declarations, one per county, and would
// massively dilute a raw "disaster count" into meaninglessness for this
// app's actual use case (roofing/water-damage/HVAC urgency framing). This
// adapter counts only incident types that plausibly cause the kind of
// physical property damage those verticals care about, and explicitly
// excludes Biological/Chemical/Toxic Substances/Other.
const RELEVANT_INCIDENT_TYPES = new Set([
  "Hurricane",
  "Severe Storm",
  "Flood",
  "Winter Storm",
  "Tropical Storm",
  "Severe Ice Storm",
  "Fire",
  "Tornado",
  "Snowstorm",
  "Coastal Storm",
  "Earthquake",
  "Straight-Line Winds",
  "Mud/Landslide",
  "Typhoon",
  "Dam/Levee Break",
  "Tropical Depression",
  "Volcanic Eruption",
]);

interface FemaDeclarationRow {
  fipsStateCode: string;
  fipsCountyCode: string;
  incidentType: string;
}

/**
 * FEMA OpenFEMA Disaster Declarations Summaries — count of property-
 * damage-relevant federal disaster declarations per county over the
 * trailing 10 years. Public API, no key required, verified live (see
 * notes above) — same confidence level as irs_migration, not an
 * "unverified pending credential" adapter like NOAA/EIA.
 *
 * Reported at COUNTY resolution and attributed to every zip in that
 * county (isInferred: true), reusing Location.countyFips exactly like
 * irs_migration. One bulk call per collection run (lazy-cached across
 * concurrent fetchOne() calls), not per-zip — OpenFEMA returns every
 * matching row nationwide in one response.
 */
export class FemaDisasterDeclarationsAdapter implements CollectorAdapter {
  adapterKey = "fema_disaster_declarations";
  nativeGeoResolution = "COUNTY" as const;

  private dataPromise: Promise<Map<string, number>> | null = null;

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    if (!location.countyFips) {
      throw new LocationFetchError(`No countyFips for zip ${location.zip} — run scripts/backfill-county-fips.ts first.`);
    }
    const data = await this.ensureData();
    const count = data.get(location.countyFips) ?? 0; // a real 0 (no matching declarations) is a valid, meaningful value

    return [
      {
        metric: "fema_disaster_declarations_10yr",
        value: count,
        unit: `count/${LOOKBACK_YEARS}yr`,
        resolvedAtResolution: "COUNTY",
        isInferred: true,
        confidence: 0.9,
      },
    ];
  }

  private async ensureData(): Promise<Map<string, number>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, number>> {
    const since = new Date();
    since.setFullYear(since.getFullYear() - LOOKBACK_YEARS);
    const sinceIso = since.toISOString();

    const params = new URLSearchParams({
      $filter: `declarationDate ge '${sinceIso}'`,
      $select: "fipsStateCode,fipsCountyCode,incidentType",
      $top: "50000", // headroom over the ~25k rows/10yr observed live — a real count above this is itself a drift signal
      $format: "json",
      $inlinecount: "allpages",
    });

    const { status, body } = await fetchWithCurlFallback(`${FEMA_BASE_URL}?${params.toString()}`);
    assertHttpOk(status, body, "FEMA request failed");

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError("FEMA response was not valid JSON.");
    }

    const envelope = parsed as { metadata?: { count?: unknown }; DisasterDeclarationsSummaries?: unknown };
    const rows = envelope.DisasterDeclarationsSummaries;
    if (!Array.isArray(rows)) {
      throw new SchemaDriftError('FEMA response missing "DisasterDeclarationsSummaries" array (schema drift).');
    }

    const totalCount = envelope.metadata?.count;
    if (typeof totalCount === "number" && totalCount > rows.length) {
      // $top didn't capture every matching row — silently undercounting
      // every county is worse than failing loudly.
      throw new SchemaDriftError(
        `FEMA reports ${totalCount} total matching rows but only ${rows.length} were returned — $top is no longer sufficient.`
      );
    }

    const result = new Map<string, number>();
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      if (typeof row.fipsStateCode !== "string" || typeof row.fipsCountyCode !== "string" || typeof row.incidentType !== "string") {
        throw new SchemaDriftError('FEMA declaration row missing/retyped fipsStateCode, fipsCountyCode, or incidentType.');
      }
      const parsedRow: FemaDeclarationRow = {
        fipsStateCode: row.fipsStateCode,
        fipsCountyCode: row.fipsCountyCode,
        incidentType: row.incidentType,
      };
      if (!RELEVANT_INCIDENT_TYPES.has(parsedRow.incidentType)) continue;

      const countyFips = parsedRow.fipsStateCode + parsedRow.fipsCountyCode;
      result.set(countyFips, (result.get(countyFips) ?? 0) + 1);
    }
    return result;
  }
}
