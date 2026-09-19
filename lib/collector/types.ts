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
  /**
   * Khoảng thời gian dữ liệu MÔ TẢ, ISO 8601: "2019-01-01/2023-12-31".
   *
   * KHÁC `fetchedAt`. fetchedAt là lúc ta tải về; cái này là lúc thế giới
   * được đo. ACS5 bản 2023 mô tả 2019–2023, nên một trang khai ngày tải như
   * thể nó là năm dữ liệu sẽ nói sai bốn năm.
   *
   * Dựng TỪ CHÍNH hằng số adapter dùng để ghép URL. Một chuỗi viết tay ở chỗ
   * khác đúng vào ngày viết rồi lệch lặng lẽ ở lần ai đó nâng năm — và không
   * gì kêu, vì cả hai đều là chuỗi hợp lệ.
   *
   * `null` KHÔNG phải "chưa tra cứu". Nó dành cho nguồn thật sự không có kỳ
   * lịch: một MÔ HÌNH chạy trên năm khí tượng điển hình (PVWatts), hoặc một
   * CỬA SỔ TRƯỢT tính từ ngày chạy (FEMA). Với những nguồn đó, khai một
   * khoảng là biến một mô hình thành một phép đo, hoặc khai đúng đúng một
   * ngày rồi sai mọi ngày sau.
   *
   * Trường BẮT BUỘC dù cho phép null: một trường tuỳ chọn thì adapter mới sẽ
   * quên, và quên ở đây không làm gì đỏ.
   */
  temporalCoverage: string | null;
  /** the geo resolution this source natively reports at */
  nativeGeoResolution: GeoResolution;
  fetchOne(location: LocationRef): Promise<CollectedDataPoint[]>;
}
