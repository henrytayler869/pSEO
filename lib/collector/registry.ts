import { MissingCredentialError } from "./errors";
import type { CollectorAdapter } from "./types";
import { PvWattsAdapter } from "./adapters/pvwatts";
import { PvWattsMockAdapter } from "./adapters/pvwatts-mock";
import { CensusAcsHousingAdapter } from "./adapters/census-acs-housing";
import { CensusMobilityAdapter } from "./adapters/census-mobility";
import { IrsMigrationAdapter } from "./adapters/irs-migration";
import { FarsFatalCrashesAdapter } from "./adapters/fars-fatal-crashes";
import { CensusCommuteAdapter } from "./adapters/census-commute";
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
/**
 * Mọi adapter đã hiện thực.
 *
 * ⚠️ THÊM ADAPTER MỚI PHẢI THÊM VÀO ĐÂY. Danh sách này là thứ
 * scripts/run-scheduled-collection.ts duyệt để làm mới dữ liệu định kỳ —
 * adapter vắng mặt sẽ thu thập được đúng một lần rồi ĐÓNG BĂNG vĩnh viễn,
 * trong khi mọi nguồn khác tự cập nhật hằng năm. Không có lỗi nào báo:
 * DataSource vẫn active, snapshot vẫn OK, chỉ là version không bao giờ tăng.
 *
 * Đã suýt xảy ra với fars_fatal_crashes và census_commute (15/9/2026).
 */
export const ALL_ADAPTER_KEYS = [
  "nrel_pvwatts",
  "census_acs_housing",
  "census_mobility",
  "irs_migration",
  "noaa_climate_normals",
  "eia_electricity",
  "fema_disaster_declarations",
  "fars_fatal_crashes",
  "census_commute",
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
    case "fars_fatal_crashes":
      return new FarsFatalCrashesAdapter(); // public NHTSA static CSV bundle, no credential needed
    case "census_commute": {
      const apiKey = await getCredential("CENSUS_API_KEY");
      if (!apiKey) {
        throw new MissingCredentialError(
          "Chưa cấu hình CENSUS_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể thu thập Census B08301/B08303. " +
            "Lấy key miễn phí, cấp tức thì tại api.census.gov/data/key_signup.html. Không có đường tắt giả lập cho nguồn này.",
          "CENSUS_API_KEY"
        );
      }
      return new CensusCommuteAdapter(apiKey);
    }
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

/**
 * Kỳ phủ thời gian của từng adapter, theo adapterKey.
 *
 * Dựng bằng cách HỎI CHÍNH adapter, không bằng một bảng tra viết tay: bảng
 * tra sẽ đúng vào ngày viết rồi lệch lặng lẽ ở lần ai đó nâng ACS_YEAR — và
 * không gì kêu, vì cả hai đều là chuỗi hợp lệ.
 *
 * Adapter nào cần khoá API mà môi trường không có thì bỏ qua: hàm này chỉ đọc
 * một hằng số, nhưng resolveAdapter() dựng cả đối tượng và vài adapter đòi
 * khoá trong constructor. Bỏ qua chứ không ném — thiếu kỳ phủ của một nguồn
 * không được làm hỏng cả phản hồi API.
 */
export async function temporalCoverageByAdapter(): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const key of ALL_ADAPTER_KEYS) {
    try {
      const adapter = await resolveAdapter(key);
      out.set(key, adapter.temporalCoverage);
    } catch {
      // Không có khoá, hoặc adapter chưa triển khai. Không đặt gì — người gọi
      // đọc ra null và xử như "không biết", đúng nghĩa.
    }
  }
  return out;
}
