import type { CollectorAdapter, CollectedDataPoint, LocationRef } from "../types";
import { SchemaDriftError, LocationFetchError, assertHttpOk } from "../errors";
import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";
import { readZipEntry } from "../zip-entry";
import { parseCsv, headerIndex } from "../csv";

/**
 * NHTSA FARS — số vụ tai nạn giao thông CÓ NGƯỜI CHẾT theo hạt, mỗi năm.
 *
 * Nguồn duy nhất trong hệ này đo đúng nghề `auto-accident-attorney`. Trước
 * nó, 0/7 nguồn gắn nhãn ngành đó, nên `governmentData` rỗng cho cả 582 thị
 * trường và niche không dựng được trang nào.
 *
 * ⚠️ KHÔNG dùng CrashAPI. `crashviewer.nhtsa.dot.gov/CrashAPI/*` trả 403 cho
 * mọi endpoint đã thử (GetCrashesByLocation, GetInjurySeverityCounts,
 * GetFARSData), kể cả kèm User-Agent trình duyệt — đo 15/9/2026. Thứ tải
 * được là bộ CSV tĩnh hằng năm.
 *
 * Hình dạng tĩnh thật ra TỐT HƠN cho một collector: một file mỗi năm, kiểm
 * được tổng, không rate limit, và snapshot tái lập được — cùng loại với
 * irs-migration, khác mọi adapter gọi API.
 *
 * ⚠️ FARS CHỈ ĐẾM VỤ CÓ NGƯỜI CHẾT. Tên metric mang chữ `fatal` vì một trang
 * viết "X vụ tai nạn ở hạt này" trong khi nguồn đo "X vụ tai nạn CHẾT NGƯỜI"
 * là sai phạm vi — cùng loại lỗi với gán số cấp hạt cho một ZIP, chỉ khác
 * trục. Tên trường là nơi rẻ nhất để chặn nhầm lẫn đó.
 */

/**
 * Năm dữ liệu, cố định và tường minh.
 *
 * KHÔNG tự lấy năm mới nhất. NHTSA phát hành trễ khoảng hai năm và không
 * phát hành cùng ngày mọi năm, nên "mới nhất" sẽ đổi dưới chân người đọc:
 * một trang nói "47 vụ năm ngoái" mà con số nhảy sang năm khác giữa hai lần
 * thu thập là một trang nói sai mà không ai đổi câu chữ.
 *
 * Nâng năm là một QUYẾT ĐỊNH, kèm chạy lại collector và kiểm lại mọi đoạn
 * văn đã sinh — vì fingerprint fact đổi, đúng như §3.5 mô tả.
 */
import { FARS_DATA_YEAR as DATA_YEAR, TEMPORAL_COVERAGE } from "@/lib/collector/vintages";
const URL = `https://static.nhtsa.gov/nhtsa/downloads/FARS/${DATA_YEAR}/National/FARS${DATA_YEAR}NationalCSV.zip`;

interface CountyCrashData {
  fatalCrashes: number;
  fatalities: number;
}

export class FarsFatalCrashesAdapter implements CollectorAdapter {
  // FARS là một năm lịch trọn vẹn, không phải ước lượng nhiều năm.
  temporalCoverage = TEMPORAL_COVERAGE.fars_fatal_crashes;
  adapterKey = "fars_fatal_crashes";
  nativeGeoResolution = "COUNTY" as const;

  private dataPromise: Promise<Map<string, CountyCrashData>> | null = null;

  async fetchOne(location: LocationRef): Promise<CollectedDataPoint[]> {
    if (!location.countyFips) {
      throw new LocationFetchError(`Không có countyFips cho ZIP ${location.zip} — không nối được dữ liệu FARS cấp hạt.`);
    }
    const data = await this.ensureData();
    const row = data.get(location.countyFips);
    if (!row) {
      // Hạt không có vụ chết người nào trong năm đó là chuyện CÓ THẬT và
      // khác hẳn "không lấy được dữ liệu". Nhưng phân biệt được hai thứ đó
      // cần danh sách hạt đầy đủ, mà file này chỉ chứa hạt CÓ vụ. Nên báo
      // thiếu thay vì ghi 0 — ghi 0 là khẳng định một điều chưa đo.
      throw new LocationFetchError(
        `Không có dòng FARS ${DATA_YEAR} cho hạt FIPS ${location.countyFips} (ZIP ${location.zip}). ` +
          `File chỉ chứa hạt CÓ vụ chết người, nên đây có thể là hạt 0 vụ — không suy ra được từ file này.`
      );
    }

    // Cùng mức tin cậy với irs-migration: nguồn cấp hạt gán cho một ZIP bên
    // trong, thô hơn dữ liệu cấp ZIP trực tiếp của ACS5/PVWatts.
    const confidence = 0.85;
    return [
      {
        metric: "fars_fatal_crashes_1yr",
        value: row.fatalCrashes,
        unit: "crashes/yr",
        resolvedAtResolution: "COUNTY",
        isInferred: true,
        confidence,
      },
      {
        // Hai con số KHÁC nhau và cả hai đều cần: một vụ có thể làm chết
        // nhiều người. Chỉ đưa số vụ sẽ khiến "47" bị đọc thành số người.
        metric: "fars_fatalities_1yr",
        value: row.fatalities,
        unit: "people/yr",
        resolvedAtResolution: "COUNTY",
        isInferred: true,
        confidence,
      },
    ];
  }

  private async ensureData(): Promise<Map<string, CountyCrashData>> {
    if (!this.dataPromise) this.dataPromise = this.fetchAll();
    return this.dataPromise;
  }

  private async fetchAll(): Promise<Map<string, CountyCrashData>> {
    const { status, body } = await fetchWithCurlFallback(URL);
    assertHttpOk(status, body, `Tải bộ FARS ${DATA_YEAR} thất bại (${URL})`, { unauthenticated: true });

    const csv = readZipEntry(body, "accident.csv");

    // utf-8 (KHÔNG phải latin-1): cột đầu của file có BOM UTF-8. Đọc sai
    // encoding cho ra tên cột "﻿STATE", `indexOf("STATE")` trả -1, và
    // phép gộp ra 0 hạt — một mảng rỗng, không phải một lỗi. Đã mắc đúng
    // lỗi này lúc khảo sát.
    /**
     * Bộ đọc CSV đúng chuẩn, KHÔNG phải split(",").
     *
     * accident.csv có 1.107 / 39.422 dòng chứa trường có ngoặc kép, và FATALS
     * là cột thứ 79 trong 80 — nên mọi lệch cột đều trúng nó. Đo 17/9/2026
     * trên chính file này:
     *
     *   split(",")   vụ=38.878  người=80.360  tỷ lệ 2,07
     *   đúng chuẩn   vụ=39.419  người=42.718  tỷ lệ 1,08
     *   NHTSA        vụ=39.221  người=42.795  tỷ lệ 1,09
     *
     * Số người chết cao GẦN GẤP ĐÔI, và 541 vụ bị nuốt hẳn vì STATE/COUNTY
     * lệch tới mức không parse được. Cả hai sai số đều im lặng.
     */
    const rows = parseCsv(csv.toString("utf-8"));
    if (rows.length < 2) throw new SchemaDriftError(`accident.csv trong bộ FARS ${DATA_YEAR} rỗng.`);

    const header = rows[0];
    const stateIdx = headerIndex(header, "STATE");
    const countyIdx = headerIndex(header, "COUNTY");
    const fatalsIdx = headerIndex(header, "FATALS");
    if ([stateIdx, countyIdx, fatalsIdx].includes(-1)) {
      throw new SchemaDriftError(
        `accident.csv thiếu cột mong đợi (STATE/COUNTY/FATALS). Cột nhận được: ${header.slice(0, 15).join(", ")}…`
      );
    }

    const result = new Map<string, CountyCrashData>();
    let parsed = 0;
    let skippedUnparsable = 0;
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const state = Number(cols[stateIdx]);
      const county = Number(cols[countyIdx]);
      const fatals = Number(cols[fatalsIdx]);
      if (!Number.isFinite(state) || !Number.isFinite(county)) {
        skippedUnparsable++;
        continue;
      }

      // FARS dùng mã hạt 997/998/999 cho "không rõ"/"ngoài hạt". Gộp chúng
      // vào một FIPS thật sẽ cộng vụ của nơi khác vào một hạt có thật.
      if (county >= 997) continue;

      const fips = `${String(state).padStart(2, "0")}${String(county).padStart(3, "0")}`;
      const e = result.get(fips) ?? { fatalCrashes: 0, fatalities: 0 };
      e.fatalCrashes += 1;
      e.fatalities += Number.isFinite(fatals) ? fatals : 0;
      result.set(fips, e);
      parsed++;
    }

    /**
     * Dòng không đọc được là LỖI, không phải chuyện thường.
     *
     * Bản trước bỏ qua im lặng và mất 541 vụ. Ngưỡng 0,5% đủ rộng cho một dòng
     * rác lẻ ở cuối file, và đủ chặt để bắt một lần đổi định dạng.
     */
    if (skippedUnparsable > (rows.length - 1) * 0.005) {
      throw new SchemaDriftError(
        `accident.csv: ${skippedUnparsable}/${rows.length - 1} dòng không đọc được STATE/COUNTY. ` +
          `Định dạng có thể đã đổi — một bản trước của adapter này mất 541 vụ đúng theo cách đó.`
      );
    }

    // Một file tải về đủ 33 MB nhưng gộp ra vài chục hàng nghĩa là cột đã
    // đổi tên hoặc encoding sai — trông y như "năm đó ít tai nạn". Ngưỡng
    // đặt rất thấp so với thực tế (đo 2022: 39.422 dòng, 2.844 hạt) để nó
    // chỉ nổ khi thật sự hỏng.
    if (parsed < 1000 || result.size < 200) {
      throw new SchemaDriftError(
        `Bộ FARS ${DATA_YEAR} chỉ gộp được ${parsed} dòng trên ${result.size} hạt — quá thấp so với một năm thật. ` +
          `Nhiều khả năng cột đã đổi tên hoặc file đọc sai encoding.`
      );
    }
    return result;
  }
}
