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

/** Maps a DataSource.adapterKey to a live adapter instance. */
export async function resolveAdapter(adapterKey: string): Promise<CollectorAdapter> {
  switch (adapterKey) {
    case "nrel_pvwatts": {
      const apiKey = await getCredential("NREL_API_KEY");
      if (apiKey) return new PvWattsAdapter(apiKey);
      if (process.env.ALLOW_PVWATTS_MOCK === "true") return new PvWattsMockAdapter();
      throw new Error(
        "Chưa cấu hình NREL_API_KEY (ở trang Cài đặt hoặc biến môi trường) và ALLOW_PVWATTS_MOCK không phải là " +
          "\"true\" — không thể thu thập dữ liệu PVWatts. Lấy key miễn phí tại developer.nlr.gov (trước đây là developer.nrel.gov), hoặc đặt " +
          "ALLOW_PVWATTS_MOCK=true để chạy demo cục bộ (dữ liệu giả lập, không phải dữ liệu thật)."
      );
    }
    case "census_acs_housing": {
      const apiKey = await getCredential("CENSUS_API_KEY");
      if (!apiKey) {
        throw new Error(
          "Chưa cấu hình CENSUS_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu Census ACS5. " +
            "Lấy key miễn phí, cấp tức thì tại api.census.gov/data/key_signup.html. Không có đường tắt giả lập cho nguồn này."
        );
      }
      return new CensusAcsHousingAdapter(apiKey);
    }
    case "census_mobility": {
      const apiKey = await getCredential("CENSUS_API_KEY");
      if (!apiKey) {
        throw new Error(
          "Chưa cấu hình CENSUS_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu Census B07003. " +
            "Lấy key miễn phí, cấp tức thì tại api.census.gov/data/key_signup.html. Không có đường tắt giả lập cho nguồn này."
        );
      }
      return new CensusMobilityAdapter(apiKey);
    }
    case "irs_migration":
      return new IrsMigrationAdapter(); // public IRS SOI file, no credential needed
    case "noaa_climate_normals": {
      const apiToken = await getCredential("NOAA_API_TOKEN");
      if (!apiToken) {
        throw new Error(
          "Chưa cấu hình NOAA_API_TOKEN (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu NOAA Climate Normals. " +
            "Lấy token miễn phí qua email tại ncdc.noaa.gov/cdo-web/token. Không có đường tắt giả lập cho nguồn này."
        );
      }
      return new NoaaClimateNormalsAdapter(apiToken);
    }
    case "eia_electricity": {
      const apiKey = await getCredential("EIA_API_KEY");
      if (!apiKey) {
        throw new Error(
          "Chưa cấu hình EIA_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập dữ liệu EIA Electricity Prices. " +
            "Lấy key miễn phí, cấp tức thì tại eia.gov/opendata. Không có đường tắt giả lập cho nguồn này."
        );
      }
      return new EiaElectricityAdapter(apiKey);
    }
    case "fema_disaster_declarations":
      return new FemaDisasterDeclarationsAdapter(); // public OpenFEMA API, no credential needed
    default:
      throw new Error(`Chưa có adapter được triển khai cho "${adapterKey}".`);
  }
}
