import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";

const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";
/** DataForSEO nhận tối đa 1000 từ khoá một lần cho endpoint này. */
const BATCH = 1000;

/**
 * Ý định tìm kiếm cho CHÍNH những từ khoá pipeline đang nhắm.
 *
 * Khác `related_keywords` (từ khoá gợi ý quanh một seed), endpoint này trả ý
 * định cho danh sách từ khoá mình đưa vào — tức đúng những chuỗi mỗi thị
 * trường đang xếp hạng.
 *
 * Vì sao cần per-market chứ không per-niche: đo 11/9/2026 trên 198 từ khoá
 * của moving-services cho ra 133 commercial, 41 informational, 13
 * navigational, 11 transactional — và sự khác nhau KHÔNG nằm ở mẫu câu. Cùng
 * mẫu "movers {city}": "movers chicago" là informational, "movers
 * pflugerville" là transactional. Gán một nhãn cho cả ngành là lấy nhãn của
 * đa số áp lên 65 thị trường không thuộc nhóm đó.
 *
 * Chi phí đo được: $0.03576 cho 198 từ khoá.
 */
export interface KeywordIntent {
  keyword: string;
  intent: string | null;
}

export async function fetchSearchIntent(keywords: string[]): Promise<KeywordIntent[]> {
  const login = await getCredential("DATAFORSEO_LOGIN");
  const password = await getCredential("DATAFORSEO_PASSWORD");
  if (!login || !password) {
    throw new Error("Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD — không đo được ý định tìm kiếm.");
  }
  const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");

  const out: KeywordIntent[] = [];
  for (let i = 0; i < keywords.length; i += BATCH) {
    const slice = keywords.slice(i, i + BATCH);
    const response = await fetch(`${DATAFORSEO_BASE_URL}/dataforseo_labs/google/search_intent/live`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify([{ keywords: slice, language_code: "en" }]),
    });
    if (!response.ok) {
      throw new Error(`Yêu cầu DataForSEO (search_intent) thất bại: ${response.status} ${response.statusText}.`);
    }
    const body: unknown = await response.json();
    const items = extractItems(body);
    if (!items) {
      // Hủy cả lô thay vì ghi một phần: một lô ghi dở sẽ để lại vài thị trường
      // có ý định và phần còn lại null, và null lúc đó không còn phân biệt
      // được "chưa đo" với "đo hỏng".
      throw new Error("Phản hồi DataForSEO (search_intent) không đúng cấu trúc mong đợi — hủy, không ghi dữ liệu chưa xác thực.");
    }
    out.push(...items);
  }
  return out;
}

/** Kết quả một lượt đo, đủ để người chạy thấy nó làm gì chứ không chỉ thấy
 * "xong". `unresolved` là những chuỗi DataForSEO không trả nhãn — chúng ở lại
 * null, và null đó vẫn nghĩa là "chưa biết", không phải "không có ý định". */
export interface IntentMeasurement {
  /** Số chuỗi từ khoá đã gửi đi đo. */
  keywords: number;
  /** Số chuỗi DataForSEO trả về (kể cả trả về mà không có nhãn). */
  measured: number;
  /** Số HÀNG KeywordMetric được ghi nhãn. */
  updated: number;
  unresolved: string[];
  byIntent: Record<string, number>;
}

/**
 * Đo và lưu ý định cho từ khoá của một ngành.
 *
 * Ghi theo CHUỖI từ khoá, không theo từng hàng: cùng một chuỗi xuất hiện ở
 * nhiều thị trường (198 chuỗi trên 712 hàng), và đo lại từng hàng là trả tiền
 * cho cùng một câu hỏi nhiều lần.
 *
 * `onlyMissing` là mặc định, và mặc định đó có lý do trả giá bằng tiền lẫn
 * bằng nội dung. Đo lại cả ngành thì (1) trả tiền cho những chuỗi đã biết câu
 * trả lời, và (2) GHI ĐÈ nhãn của những thị trường đang có bài — mà nhãn ý
 * định chọn template và chọn tiêu đề, nên một nhãn đổi âm thầm là một trang
 * đổi hình dạng mà không ai yêu cầu. Đo lại toàn bộ phải là một lựa chọn gõ
 * ra bằng tay.
 */
export async function measureAndStoreIntents(
  vertical: string,
  opts: { onlyMissing?: boolean } = {}
): Promise<IntentMeasurement> {
  const onlyMissing = opts.onlyMissing ?? true;

  const rows = await prisma.keywordMetric.findMany({
    where: { marketIdentity: { vertical }, ...(onlyMissing ? { mainIntent: null } : {}) },
    select: { keyword: true },
  });
  const keywords = [...new Set(rows.map((r) => r.keyword))];
  const empty: IntentMeasurement = { keywords: 0, measured: 0, updated: 0, unresolved: [], byIntent: {} };
  if (keywords.length === 0) return empty;

  const results = await fetchSearchIntent(keywords);

  let updated = 0;
  const unresolved: string[] = [];
  const byIntent: Record<string, number> = {};
  for (const r of results) {
    if (!r.intent) {
      unresolved.push(r.keyword);
      continue;
    }
    // Chỉ ghi lên hàng đang null khi onlyMissing: cùng một chuỗi có thể đã
    // mang nhãn ở thị trường khác, và lượt này không được phép sửa nhãn đó.
    const res = await prisma.keywordMetric.updateMany({
      where: { keyword: r.keyword, marketIdentity: { vertical }, ...(onlyMissing ? { mainIntent: null } : {}) },
      data: { mainIntent: r.intent },
    });
    updated += res.count;
    byIntent[r.intent] = (byIntent[r.intent] ?? 0) + res.count;
  }

  // Chuỗi gửi đi mà không thấy trong phản hồi cũng là chưa giải được — im
  // lặng bỏ chúng sẽ làm "đã đo hết" đúng với số đã gửi và sai với thực tế.
  const returned = new Set(results.map((r) => r.keyword));
  for (const k of keywords) if (!returned.has(k)) unresolved.push(k);

  return { keywords: keywords.length, measured: results.length, updated, unresolved, byIntent };
}

function extractItems(body: unknown): KeywordIntent[] | null {
  if (typeof body !== "object" || body === null) return null;
  const tasks = (body as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const task = tasks[0] as Record<string, unknown> | null;
  if (!task || (task.status_code !== undefined && task.status_code !== 20000)) return null;
  const result = task.result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const items = (result[0] as Record<string, unknown> | null)?.items;
  if (!Array.isArray(items)) return null;

  const rows: KeywordIntent[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) return null;
    const keyword = (item as Record<string, unknown>).keyword;
    if (typeof keyword !== "string") return null;
    const ki = (item as Record<string, unknown>).keyword_intent;
    const label = typeof ki === "object" && ki !== null ? (ki as Record<string, unknown>).label : null;
    rows.push({ keyword, intent: typeof label === "string" ? label : null });
  }
  return rows;
}
