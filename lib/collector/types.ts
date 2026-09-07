import type { GeoResolution } from "@prisma/client";

export interface LocationRef {
  locationId: string;
  zip: string;
  city: string | null;
  state: string;
  lat: number | null;
  lon: number | null;
  countyFips: string | null;
}

export interface CollectedDataPoint {
  metric: string;
  value: number;
  unit: string;
  resolvedAtResolution: GeoResolution;
  isInferred: boolean;
  confidence: number;
}

/**
 * One adapter per external data source. fetchOne is per-location so the
 * runner (lib/collector/run.ts) can retry, rate-limit, and log failures
 * per-location without one bad zip poisoning the whole run — except for
 * schema drift, which throwing SchemaDriftError signals as a whole-source
 * problem (see errors.ts).
 */
export interface CollectorAdapter {
  /** matches DataSource.adapterKey */
  adapterKey: string;
  /** the geo resolution this source natively reports at */
  nativeGeoResolution: GeoResolution;
  fetchOne(location: LocationRef): Promise<CollectedDataPoint[]>;
}
