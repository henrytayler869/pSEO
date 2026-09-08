import { MissingCredentialError } from "./errors";
import type { CollectorAdapter } from "./types";
import { PvWattsAdapter } from "./adapters/pvwatts";
import { PvWattsMockAdapter } from "./adapters/pvwatts-mock";
import { CensusAcsHousingAdapter } from "./adapters/census-acs-housing";
import { CensusMobilityAdapter } from "./adapters/census-mobility";
import { IrsMigrationAdapter } from "./adapters/irs-migration";
import { NoaaClimateNormalsAdapter } from "./adapters/noaa-climate-normals";
import { EiaElectricityAdapter } from "./adapters/eia-electricity";
import { FemaDisasterDeclarationsAdapter } from "./adapters/fema-disaster-declarations";
import { getCredential } from "@/lib/settings/credentials";

/**
 * Every adapter this system implements — one list, so the others cannot drift.
 *
 * There were two: the switch below, and a copy in
 * scripts/run-scheduled-collection.ts deciding which sources a scheduled run
 * touches. A third was about to appear in the validation config. Copies of a
 * list like this do not fail loudly when they disagree; a source simply stops
 * being collected, or stops being checked, and the reports stay green because
 * nothing is missing from the list that produced them.
 */
export const ALL_ADAPTER_KEYS = [
  "nrel_pvwatts",
  "census_acs_housing",
  "census_mobility",
  "irs_migration",
  "noaa_climate_normals",
  "eia_electricity",
  "fema_disaster_declarations",
] as const;

/** Maps a DataSource.adapterKey to a live adapter instance. */
export async function resolveAdapter(adapterKey: string): Promise<CollectorAdapter> {
  switch (adapterKey) {
    case "nrel_pvwatts": {
      const apiKey = await getCredential("NREL_API_KEY");
      if (apiKey) return new PvWattsAdapter(apiKey);
      if (process.env.ALLOW_PVWATTS_MOCK === "true") return new PvWattsMockAdapter();
      throw new MissingCredentialError(
        "Chưa cấu hình NREL_API_KEY (ở trang Cài đặt hoặc biến môi trường) và ALLOW_PVWATTS_MOCK không phải là " +
          "\"true\" — không thể thu thập dữ liệu PVWatts. Lấy key miễn phí tại developer.nlr.gov (trước đây là developer.nrel.gov), hoặc đặt " +
          "ALLOW_PVWATTS_MOCK=true để chạy demo cục bộ (dữ liệu giả lập, không phải dữ liệu thật)."
      ,
        "NREL_API_KEY"
      );
    }
    case "census_acs_housing": {
      const apiKey = await getCredential("CENSUS_API_KEY");
      if (!apiKey) {
        throw new MissingCredentialError(
          "Chưa cấu hình CENSUS_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu Census ACS5. " +
            "Lấy key miễn phí, cấp tức thì tại api.census.gov/data/key_signup.html. Không có đường tắt giả lập cho nguồn này."
        ,
          "CENSUS_API_KEY"
        );
      }
      return new CensusAcsHousingAdapter(apiKey);
    }
    case "census_mobility": {
      const apiKey = await getCredential("CENSUS_API_KEY");
      if (!apiKey) {
        throw new MissingCredentialError(
          "Chưa cấu hình CENSUS_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu Census B07003. " +
            "Lấy key miễn phí, cấp tức thì tại api.census.gov/data/key_signup.html. Không có đường tắt giả lập cho nguồn này."
        ,
          "CENSUS_API_KEY"
        );
      }
      return new CensusMobilityAdapter(apiKey);
    }
    case "irs_migration":
      return new IrsMigrationAdapter(); // public IRS SOI file, no credential needed
    case "noaa_climate_normals": {
      const apiToken = await getCredential("NOAA_API_TOKEN");
      if (!apiToken) {
        throw new MissingCredentialError(
          "Chưa cấu hình NOAA_API_TOKEN (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu NOAA Climate Normals. " +
            "Lấy token miễn phí qua email tại ncdc.noaa.gov/cdo-web/token. Không có đường tắt giả lập cho nguồn này."
        ,
          "NOAA_API_TOKEN"
        );
      }
      return new NoaaClimateNormalsAdapter(apiToken);
    }
    case "eia_electricity": {
      const apiKey = await getCredential("EIA_API_KEY");
      if (!apiKey) {
        throw new MissingCredentialError(
          "Chưa cấu hình EIA_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu EIA Electricity Prices. " +
            "Lấy key miễn phí, cấp tức thì tại eia.gov/opendata. Không có đường tắt giả lập cho nguồn này."
        ,
          "EIA_API_KEY"
        );
      }
      return new EiaElectricityAdapter(apiKey);
    }
    case "fema_disaster_declarations": {
      // OpenFEMA needs no credential — but Akamai blocks fema.gov from
      // datacenter IP ranges, so the server gets 403 on every request while the
      // same URL answers 200 from a residential connection. An optional proxy
      // origin routes around that; leaving it unset calls FEMA directly, which
      // is correct anywhere the block does not apply.
      const proxyOrigin = (await getCredential("FEMA_API_BASE_URL")) ?? null;
      const proxySecret = (await getCredential("FEMA_PROXY_SECRET")) ?? null;
      if (proxyOrigin && !proxySecret) {
        throw new MissingCredentialError(
          "Đã cấu hình FEMA_API_BASE_URL nhưng thiếu FEMA_PROXY_SECRET — proxy sẽ từ chối mọi request.",
          "FEMA_PROXY_SECRET"
        );
      }
      return new FemaDisasterDeclarationsAdapter(proxyOrigin, proxySecret);
    }
    default:
      throw new Error(`Chưa có adapter được triển khai cho "${adapterKey}".`);
  }
}
