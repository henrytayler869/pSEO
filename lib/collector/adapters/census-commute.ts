import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError, assertHttpOk } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

const ACS_YEAR = 2023;

/**
 * Mã biến ACS, tra thẳng từ `variables.json` ngày 15/9/2026 — KHÔNG lấy theo
 * trí nhớ. Nhãn nguyên văn ghi kèm từng dòng để lần sau ai đổi mã thì thấy
 * ngay mình đang đổi cái gì.
 *
 * ⚠️ Đây là chỗ đã suýt sai. Khảo sát ban đầu dùng một mình `B08303_013E`
 * cho "60 phút trở lên" — nhưng biến đó là **90 phút trở lên**. Con số ra
 * 3,1% thay vì 12,3%, và "3,1% đi làm trên một giờ" nghe hoàn toàn bình
 * thường nên không ai nghi.
 *
 * Nhóm lỗi này KHÔNG có luật nào bắt được: validator so văn bản với fact,
 * không so fact với thực tế. Một fact sai nhãn thì mọi tầng phía sau đều
 * xác nhận nó đúng. Chỗ duy nhất chặn được là ở đây, lúc định nghĩa fact.
 */
const VARIABLES = {
  // "Estimate › Total:" — tổng số người đi làm (mẫu số của B08301)
  workersTotal: "B08301_001E",
  // "Estimate › Total: › Car, truck, or van:"
  byCar: "B08301_002E",
  // "Estimate › Total:" — tổng của B08303, mẫu số riêng
  commuteTotal: "B08303_001E",
  // "Estimate › Total: › 60 to 89 minutes"
  min60to89: "B08303_012E",
  // "Estimate › Total: › 90 or more minutes"
  min90plus: "B08303_013E",
};

const SUPPRESSED_VALUE = -666666666; // sentinel "không ước lượng tin cậy được" của Census

interface ZctaCommute {
  carSharePct: number | null;
  min60PlusPct: number | null;
  workersTotal: number | null;
}

/**
 * Census ACS5 — cách đi làm và thời gian đi làm, theo từng ZIP.
 *
 * Vì sao nguồn này tồn tại: `fars_fatal_crashes` là nguồn duy nhất đo đúng
 * nghề `auto-accident-attorney`, nhưng nó CẤP HẠT. Đo trên tập trang thật:
 * 76 trang nằm trên 62 hạt, 7 hạt bị nhiều trang dùng chung, nên **21/76
 * trang có governmentData trùng khít từng chữ số** — 5 trang Los Angeles
 * cùng in 817 vụ / 1.199 người chết, khác nhau mỗi tên thành phố. Đó là
 * định nghĩa thin content ở guide §3.4.
 *
 * Bảng này cấp ZIP nên nó là TRỤC PHÂN BIỆT còn thiếu. Đo trên 161 ZIP của
 * niche: phủ 161/161, tỷ lệ đi ô tô 5,3–93,9%, tỷ lệ đi làm ≥60 phút
 * 2,1–42,8%. Trong riêng Los Angeles County, 11 ZIP chênh 76,6–87,7% ở trục
 * thứ nhất và 10,0–19,1% ở trục thứ hai.
 *
 * Vì sao là bảng NÀY chứ không phải `census_acs_housing`: giá nhà trung vị
 * trên trang luật sư tai nạn xe là "không câu nào sai, chỉ là sai nghề" —
 * đúng bẫy §3.7 bài học 1. Mức phơi nhiễm với giao thông đường bộ thì không
 * sai nghề.
 *
 * ⚠️ KHÔNG suy ra mức nguy hiểm từ hai trục này. FARS không chuẩn hoá theo
 * dân số hay số dặm xe chạy, nên "ZIP này 87% đi ô tô nên nguy hiểm hơn" là
 * kết luận không có nguồn. Ràng buộc đó thuộc về prompt và luật nội dung,
 * không thuộc adapter — ghi ở đây để người viết prompt đọc được.
 */
export class CensusCommuteAdapter implements CollectorAdapter {
  // ACS5: ước lượng 5 năm kết thúc ở ACS_YEAR.
  temporalCoverage = `${ACS_YEAR - 4}-01-01/${ACS_YEAR}-12-31`;
  adapterKey = "census_commute";
  nativeGeoResolution = "ZIP" as const;

  private dataPromise: Promise<Map<string, ZctaCommute>> | null = null;

  constructor(private readonly apiKey: string) {}

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    const data = await this.ensureData();
    const row = data.get(location.zip);
    if (!row) throw new LocationFetchError(`Không có dòng Census B08301/B08303 cho ZIP ${location.zip}`);

    const points: CollectedDataPoint[] = [];
    // Cùng mức với hai bảng ACS5 khác: ước lượng khảo sát 5 năm, không phải
    // đếm trực tiếp — nhưng ĐƯỢC báo cáo cho chính ZIP này, nên không suy
    // từđịa lý thô hơn.
    const confidence = 0.9;
    const push = (metric: string, value: number | null, unit: string) => {
      if (value === null) return;
      points.push({ metric, value, unit, resolvedAtResolution: "ZIP", isInferred: false, confidence });
    };

    push("commute_car_share_pct", row.carSharePct, "%");
    // Tên metric mang đúng NGƯỠNG đo, không phải "long"/"dài". Một tên mờ
    // là chỗ để ngưỡng trôi mà không ai thấy.
    push("commute_60min_plus_pct", row.min60PlusPct, "%");
    push("commute_workers_total", row.workersTotal, "people");

    if (points.length === 0) {
      throw new LocationFetchError(
        `Mọi giá trị B08301/B08303 bị nén hoặc không có cho ZIP ${location.zip} — ZCTA dân số nhỏ, không phải lỗi thật`
      );
    }
    return points;
  }

  private async ensureData(): Promise<Map<string, ZctaCommute>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, ZctaCommute>> {
    const varList = Object.values(VARIABLES).join(",");
    const url =
      `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=NAME,${varList}` +
      `&for=zip%20code%20tabulation%20area:*&key=${this.apiKey}`;

    const { status, body } = await fetchWithCurlFallback(url);
    assertHttpOk(status, body, "Gọi Census B08301/B08303 thất bại");

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf-8"));
    } catch {
      throw new SchemaDriftError("Phản hồi Census B08301/B08303 không phải JSON hợp lệ.");
    }
    if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[0])) {
      throw new SchemaDriftError("Phản hồi Census B08301/B08303 không đúng hình dạng [header, ...rows].");
    }

    const header = parsed[0] as string[];
    const zctaIdx = header.findIndex((h) => h.toLowerCase().includes("zip"));
    const idx = Object.fromEntries(Object.entries(VARIABLES).map(([k, v]) => [k, header.indexOf(v)])) as Record<
      keyof typeof VARIABLES,
      number
    >;
    if (zctaIdx === -1 || Object.values(idx).includes(-1)) {
      throw new SchemaDriftError(`Phản hồi Census B08301/B08303 thiếu cột mong đợi. Cột nhận được: ${header.join(", ")}.`);
    }

    const rows = parsed.slice(1) as string[][];
    const result = new Map<string, ZctaCommute>();
    for (const r of rows) {
      const workersTotal = parseAcsValue(r[idx.workersTotal]);
      const byCar = parseAcsValue(r[idx.byCar]);
      const commuteTotal = parseAcsValue(r[idx.commuteTotal]);
      const m60 = parseAcsValue(r[idx.min60to89]);
      const m90 = parseAcsValue(r[idx.min90plus]);

      result.set(r[zctaIdx], {
        // Hai tỷ lệ dùng HAI mẫu số khác nhau — B08301_001E và B08303_001E
        // không bằng nhau. Dùng chung một mẫu số sẽ ra tỷ lệ lệch vài phần
        // trăm, đủ nhỏ để không ai nghi và đủ lớn để sai.
        carSharePct: workersTotal !== null && byCar !== null && workersTotal > 0 ? (byCar / workersTotal) * 100 : null,
        // 60+ phút = (60–89) CỘNG (90+). Dùng một mình biến 90+ là lỗi đã
        // mắc lúc khảo sát — xem chú thích ở VARIABLES.
        min60PlusPct:
          commuteTotal !== null && m60 !== null && m90 !== null && commuteTotal > 0
            ? ((m60 + m90) / commuteTotal) * 100
            : null,
        workersTotal,
      });
    }
    return result;
  }
}

function parseAcsValue(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === SUPPRESSED_VALUE || n < 0) return null;
  return n;
}
