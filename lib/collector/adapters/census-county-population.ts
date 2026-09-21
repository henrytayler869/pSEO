import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError, assertHttpOk } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

import { ACS_YEAR, TEMPORAL_COVERAGE } from "@/lib/collector/vintages";

/**
 * Mã biến tra thẳng từ variables.json ngày 21/9/2026, không lấy theo trí nhớ.
 *
 * B01003_001E — "Estimate › Total" của bảng TOTAL POPULATION. Một biến, một
 * bảng, không có biến anh em nào dễ nhầm — khác hẳn ca B08303_013E từng bị
 * dùng nhầm cho "60 phút trở lên" trong khi nó là "90 phút trở lên".
 */
const POPULATION = "B01003_001E";

/**
 * Census ACS5 — DÂN SỐ theo hạt.
 *
 * ═══ VÌ SAO NGUỒN NÀY TỒN TẠI: FARS KHÔNG CÓ MẪU SỐ ═══
 *
 * `fars_fatal_crashes_1yr` là số vụ TUYỆT ĐỐI trong một hạt. Không có dân số
 * đi kèm thì con số đó nói về ĐỘ LỚN của hạt nhiều hơn nói về đường sá ở đó:
 * Los Angeles County 817 vụ và một hạt nông thôn 12 vụ không so được với
 * nhau, và đặt cạnh nhau trên một trang là mời người đọc so sai.
 *
 * Đây là phép chuẩn hoá tiêu chuẩn cho dữ liệu tai nạn — "trên 100.000 dân" —
 * và nó là thứ duy nhất trong tầm với: NHTSA không công bố số dặm xe chạy
 * (VMT) theo hạt, chỉ theo bang, nên mẫu số theo quãng đường không dựng được
 * ở độ phân giải này.
 *
 * ═══ CÙNG ĐỘ PHÂN GIẢI VỚI TỬ SỐ, CÓ CHỦ Ý ═══
 *
 * Dân số lấy ở cấp HẠT chứ không phải cấp ZIP, dù ACS có cả hai. Chia một số
 * vụ CẤP HẠT cho dân số CẤP ZIP là sai phạm vi — nó cho ra một con số lớn gấp
 * hàng chục lần và trông vẫn như một tỷ lệ hợp lý. Tử số và mẫu số phải đo
 * cùng một vùng, và vùng đó là hạt vì FARS chỉ có hạt.
 *
 * ═══ KHÔNG PHẢI SỐ ĐO VỀ NGHỀ, MÀ LÀ MẪU SỐ ═══
 *
 * Dân số một mình không nói gì về tai nạn giao thông và KHÔNG nên hiện như
 * một "sự thật về nghề". Nó tồn tại để con số FARS đọc được. Đặc tả nội dung
 * phải đặt nó cùng mục với số vụ, không thành mục riêng.
 */
export class CensusCountyPopulationAdapter implements CollectorAdapter {
  temporalCoverage = TEMPORAL_COVERAGE.census_county_population;
  adapterKey = "census_county_population";
  nativeGeoResolution = "COUNTY" as const;

  private dataPromise: Promise<Map<string, number>> | null = null;

  constructor(private readonly apiKey: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    if (!location.countyFips) {
      throw new LocationFetchError(
        `Không có countyFips cho ZIP ${location.zip} — không nối được dân số cấp hạt.`
      );
    }
    const data = await this.ensureData();
    const population = data.get(location.countyFips);
    if (population === undefined) {
      throw new LocationFetchError(
        `Không có dòng ACS5 ${ACS_YEAR} cho hạt FIPS ${location.countyFips} (ZIP ${location.zip}).`
      );
    }

    return [
      {
        metric: "census_county_population",
        value: population,
        unit: "people",
        resolvedAtResolution: "COUNTY",
        // Cùng lý do với FARS: con số của HẠT gán cho một ZIP bên trong nó.
        isInferred: true,
        // Cùng mức với fars_fatal_crashes — nguồn cấp hạt gán cho ZIP, thô
        // hơn dữ liệu cấp ZIP trực tiếp.
        confidence: 0.85,
      },
    ];
  }

  private async ensureData(): Promise<Map<string, number>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, number>> {
    const url =
      `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=NAME,${POPULATION}` +
      `&for=county:*&key=${this.apiKey}`;

    const { status, body } = await fetchWithCurlFallback(url);
    assertHttpOk(status, body, "Gọi Census B01003 (dân số theo hạt) thất bại");

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError("Phản hồi Census B01003 không phải JSON hợp lệ.");
    }
    if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[0])) {
      throw new SchemaDriftError("Phản hồi Census B01003 không đúng hình dạng [header, ...rows].");
    }

    const header = parsed[0] as string[];
    const popIdx = header.indexOf(POPULATION);
    const stateIdx = header.indexOf("state");
    const countyIdx = header.indexOf("county");
    if (popIdx === -1 || stateIdx === -1 || countyIdx === -1) {
      throw new SchemaDriftError(
        `Phản hồi Census B01003 thiếu cột mong đợi. Cột nhận được: ${header.join(", ")}.`
      );
    }

    const out = new Map<string, number>();
    for (const row of parsed.slice(1) as string[][]) {
      // FIPS ghép ĐÚNG cách fars-fatal-crashes ghép: 2 chữ số bang + 3 chữ số
      // hạt. Lệch một chữ số đệm là hai bảng không nối được với nhau, và cách
      // hỏng là im lặng — khớp 0 hạt trông y như "hạt này không có dữ liệu".
      const fips = `${String(row[stateIdx]).padStart(2, "0")}${String(row[countyIdx]).padStart(3, "0")}`;
      const value = Number(row[popIdx]);
      if (!Number.isFinite(value) || value <= 0) continue;
      out.set(fips, value);
    }

    if (out.size < 3000) {
      // Mỹ có ~3.144 hạt. Nhận về ít hơn nhiều nghĩa là truy vấn hoặc phản hồi
      // đã đổi hình, và một bản đồ thiếu hạt sẽ hỏng dưới dạng "ZIP này không
      // có dân số" — trông như dữ liệu thiếu chứ không như nguồn hỏng.
      throw new SchemaDriftError(
        `Census B01003 chỉ trả ${out.size} hạt, dưới ngưỡng tỉnh táo 3.000 — nhiều khả năng phản hồi đã đổi hình.`
      );
    }
    return out;
  }
}
