import { getCredential } from "@/lib/settings/credentials";
import { marketFor } from "./markets";

/**
 * AI đang chiếm top cho một truy vấn — số liệu NỀN TẢNG của niche.
 *
 * ═══ VÌ SAO KD MỘT MÌNH KHÔNG ĐỦ ═══
 *
 * KD là một con số tổng hợp. Đo 25/9/2026, thị trường Việt Nam:
 *
 *     bảng xếp hạng ngoại hạng anh   823.000   KD 26
 *     lịch thi đấu ngoại hạng anh    550.000   KD 22
 *     kết quả ngoại hạng anh         301.000   KD 14
 *
 * KD 14-26 cho volume sáu chữ số là THẤP BẤT THƯỜNG, và một con số bất
 * thường cần lời giải thích trước khi được đem đi đặt cược. Ba khả năng dẫn
 * tới ba quyết định khác nhau:
 *
 *   - top toàn báo lớn, DR cao, backlink dày  -> domain DR 0 không chen được
 *   - top toàn trang dữ liệu chuyên, DR vừa   -> chen được, đó là cơ hội thật
 *   - top toàn trang mỏng/trùng lặp           -> cơ hội lớn, và KD đang nói đúng
 *
 * KD không phân biệt ba ca đó. Chỉ SERP thật phân biệt được.
 *
 * ═══ AI CHẠY CÁI NÀY ═══
 *
 * pSEO Control Panel. Đây là nghiên cứu NICHE — ai sở hữu không gian truy
 * vấn của một ngành — và nó là đầu vào để quyết dựng Publisher thế nào.
 * Dữ liệu riêng của một site đã dựng thì thuộc phiên của site đó.
 */

const BASE = "https://api.dataforseo.com/v3";

export interface SerpRow {
  position: number;
  domain: string;
  url: string;
  title: string;
  /** Loại kết quả DataForSEO khai: organic, featured_snippet, video… */
  type: string;
}

export interface SerpResult {
  keyword: string;
  locationCode: number;
  languageCode: string;
  /** null = DataForSEO không trả về tổng số kết quả cho truy vấn này. */
  totalResults: number | null;
  rows: SerpRow[];
}

/**
 * SERP cho một danh sách truy vấn, ở thị trường của nghề.
 *
 * MỘT TASK MỖI TRUY VẤN — endpoint này không nhận lô như search_volume. Nên
 * chi phí tỉ lệ THẲNG với số truy vấn, và chỗ gọi phải biết điều đó: đây là
 * endpoint đắt nhất trong ba cái HQ đang dùng.
 */
export async function fetchSerpForVertical(
  keywords: string[],
  vertical: string,
  depth = 20
): Promise<{ results: SerpResult[]; costUsd: number }> {
  const login = await getCredential("DATAFORSEO_LOGIN");
  const password = await getCredential("DATAFORSEO_PASSWORD");
  if (!login || !password) {
    throw new Error("Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD (trang Cài đặt).");
  }
  const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  const market = marketFor(vertical);

  const results: SerpResult[] = [];
  let costUsd = 0;

  for (const keyword of keywords) {
    const response = await fetch(`${BASE}/serp/google/organic/live/advanced`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keyword, location_code: market.locationCode, language_code: market.languageCode, depth },
      ]),
    });
    if (!response.ok) {
      throw new Error(`Yêu cầu DataForSEO (serp) thất bại cho "${keyword}": ${response.status} ${response.statusText}.`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    costUsd += typeof body.cost === "number" ? body.cost : 0;

    const tasks = body.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error(`Phản hồi SERP cho "${keyword}" không có task nào — hình dạng đã đổi.`);
    }
    const task = tasks[0] as Record<string, unknown>;
    if (task.status_code !== undefined && task.status_code !== 20000) {
      // Lỗi cấp task là chẩn đoán CỤ THỂ của DataForSEO; nêu nguyên văn thay
      // vì nuốt nó thành "schema drift".
      throw new Error(`DataForSEO từ chối truy vấn "${keyword}": ${task.status_code} ${task.status_message}`);
    }
    const result = Array.isArray(task.result) ? (task.result[0] as Record<string, unknown> | undefined) : undefined;
    const items = Array.isArray(result?.items) ? (result!.items as Record<string, unknown>[]) : [];

    results.push({
      keyword,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      totalResults: typeof result?.se_results_count === "number" ? (result!.se_results_count as number) : null,
      rows: items
        .filter((i) => typeof i.rank_absolute === "number" && typeof i.domain === "string")
        .map((i) => ({
          position: i.rank_absolute as number,
          domain: i.domain as string,
          url: typeof i.url === "string" ? i.url : "",
          title: typeof i.title === "string" ? i.title : "",
          type: typeof i.type === "string" ? i.type : "unknown",
        })),
    });
  }

  return { results, costUsd };
}
