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

/**
 * Đo và lưu ý định cho mọi từ khoá của một ngành.
 *
 * Ghi theo CHUỖI từ khoá, không theo từng hàng: cùng một chuỗi xuất hiện ở
 * nhiều thị trường (198 chuỗi trên 712 hàng), và đo lại từng hàng là trả tiền
 * cho cùng một câu hỏi nhiều lần.
 */
export async function measureAndStoreIntents(vertical: string): Promise<{ measured: number; updated: number }> {
  const identities = await prisma.marketIdentity.findMany({
    where: { vertical },
    select: { keywordMetrics: { select: { keyword: true } } },
  });
  const keywords = [...new Set(identities.flatMap((i) => i.keywordMetrics.map((k) => k.keyword)))];
  if (keywords.length === 0) return { measured: 0, updated: 0 };

  const results = await fetchSearchIntent(keywords);

  let updated = 0;
  for (const r of results) {
    if (!r.intent) continue;
    const res = await prisma.keywordMetric.updateMany({
      where: { keyword: r.keyword, marketIdentity: { vertical } },
      data: { mainIntent: r.intent },
    });
    updated += res.count;
  }
  return { measured: results.length, updated };
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
