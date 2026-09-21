/**
 * Năm của từng nguồn dữ liệu — MỘT định nghĩa, và không kéo theo gì.
 *
 * Vì sao là file riêng chứ không nằm trong adapter: `lib/queries/collector.ts`
 * cần bản đồ này để trả `temporalCoverage` qua API, và nó chạy trong đường
 * render của trang. Import registry để hỏi adapter kéo theo CẢ MƯỜI adapter,
 * và vài cái trong đó dùng `node:fs` để giải nén CSV. Build gãy ngay:
 *
 *   the chunking context (unknown) does not support external modules
 *   (request: node:fs)
 *   Failed to write app endpoint /publisher/[websiteId]/content/page
 *
 * Nên hằng số sống ở đây, và ADAPTER IMPORT TỪ ĐÂY để ghép URL. Chiều phụ
 * thuộc đó là thứ giữ cho hai bên không lệch: đổi năm ở đây thì URL tải về
 * đổi theo, không phải nhớ sửa hai chỗ.
 */

/** ACS5 là ước lượng 5 NĂM: bản 2023 mô tả 2019–2023. */
export const ACS_YEAR = 2023;

/** FARS phát hành theo năm lịch trọn vẹn. */
export const FARS_DATA_YEAR = 2022;

/** IRS SOI: di chuyển giữa hai kỳ khai thuế. Hậu tố tên file là "2223". */
export const SOI_FROM_YEAR = 2022;
export const SOI_TO_YEAR = 2023;

/** NOAA NORMAL_MLY là chuẩn khí hậu 30 năm. KHÔNG phải ngày trong query —
 *  CDO đòi một startdate giả, và lấy nhầm nó sẽ khai chuẩn 30 năm thành một
 *  năm, trông hoàn toàn hợp lý. */
export const NOAA_NORMALS_PERIOD = "1991-01-01/2020-12-31";

function yearRange(from: number, to: number): string {
  return `${from}-01-01/${to}-12-31`;
}

/**
 * adapterKey → kỳ phủ ISO 8601, hoặc null.
 *
 * null KHÔNG phải "chưa tra cứu". Nó dành cho nguồn thật sự không có kỳ lịch:
 * một MÔ HÌNH chạy trên năm khí tượng điển hình, hoặc một CỬA SỔ TRƯỢT tính
 * từ ngày chạy. Khai một khoảng cho chúng là biến mô hình thành phép đo, hoặc
 * khai đúng hôm nay và sai từ mai.
 */
export const TEMPORAL_COVERAGE: Record<string, string | null> = {
  census_acs_housing: yearRange(ACS_YEAR - 4, ACS_YEAR),
  census_commute: yearRange(ACS_YEAR - 4, ACS_YEAR),
  census_mobility: yearRange(ACS_YEAR - 4, ACS_YEAR),
  census_county_population: yearRange(ACS_YEAR - 4, ACS_YEAR),
  fars_fatal_crashes: yearRange(FARS_DATA_YEAR, FARS_DATA_YEAR),
  irs_migration: yearRange(SOI_FROM_YEAR, SOI_TO_YEAR),
  noaa_climate_normals: NOAA_NORMALS_PERIOD,
  nrel_pvwatts: null,
  fema_disaster_declarations: null,
  eia_electricity: null,
};
