import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";
import { latestPerKeyword } from "./latest";

const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";
const US_LOCATION_CODE = 2840;
const LANGUAGE_CODE = "en";
const RELATED_KEYWORDS_LIMIT = 20;

export interface RelatedKeywordResult {
  keyword: string;
  searchVolume: number;
  cpc: number;
  keywordDifficulty: number;
}

/**
 * Fetches real, topically-related keywords for a niche as a whole (not per
 * zip) via DataForSEO Labs' related_keywords endpoint — confirmed live
 * against the actual API before writing this (docs.dataforseo.com response
 * shapes have drifted from expectations before, see dataforseo-adapter.ts).
 * Seeded with the generic vertical phrase ("moving services"), not a
 * city-specific long-tail one, since that's what related-keyword expansion
 * is designed to work from. This is on-page SEO input for a content writer
 * (what to cover/reference), not a scoring input — it never touches
 * MarketScore.
 */
export async function fetchRelatedKeywordsForVertical(vertical: string): Promise<RelatedKeywordResult[]> {
  const login = await getCredential("DATAFORSEO_LOGIN");
  const password = await getCredential("DATAFORSEO_PASSWORD");
  if (!login || !password) {
    throw new Error("Chưa cấu hình DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD (ở trang Cài đặt hoặc biến môi trường) — không thể lấy từ khóa liên quan.");
  }
  const auth = "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  const seedKeyword = vertical.replace(/-/g, " ");

  const response = await fetch(`${DATAFORSEO_BASE_URL}/dataforseo_labs/google/related_keywords/live`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([
      { keyword: seedKeyword, location_code: US_LOCATION_CODE, language_code: LANGUAGE_CODE, limit: RELATED_KEYWORDS_LIMIT },
    ]),
  });
  if (!response.ok) {
    throw new Error(`Yêu cầu DataForSEO (related_keywords) thất bại: ${response.status} ${response.statusText}.`);
  }

  const body: unknown = await response.json();
  const items = extractRelatedKeywordItems(body);
  if (!items) {
    throw new Error("Phản hồi DataForSEO (related_keywords) không đúng cấu trúc mong đợi (schema drift) — hủy import thay vì ghi dữ liệu chưa xác thực.");
  }

  // depth 0 is the seed keyword itself, already covered by the per-zip
  // KeywordMetric data — only depth >= 1 (actually related terms) is new
  // information here. Items with no volume data are skipped, same "null
  // means no data" reasoning as dataforseo-adapter.ts.
  return items
    .filter((i) => i.depth >= 1 && i.searchVolume !== null && i.cpc !== null && i.keywordDifficulty !== null)
    .map((i) => ({ keyword: i.keyword, searchVolume: i.searchVolume!, cpc: i.cpc!, keywordDifficulty: i.keywordDifficulty! }));
}

export async function fetchAndStoreRelatedKeywords(vertical: string): Promise<{ count: number }> {
  const results = await fetchRelatedKeywordsForVertical(vertical);
  if (results.length > 0) {
    await prisma.semanticKeyword.createMany({
      data: results.map((r) => ({
        vertical,
        keyword: r.keyword,
        searchVolume: r.searchVolume,
        cpc: r.cpc,
        keywordDifficulty: r.keywordDifficulty,
        source: "dataforseo_related_keywords",
      })),
    });
  }
  return { count: results.length };
}

interface RelatedKeywordItem {
  keyword: string;
  depth: number;
  searchVolume: number | null;
  cpc: number | null;
  keywordDifficulty: number | null;
}

function extractRelatedKeywordItems(body: unknown): RelatedKeywordItem[] | null {
  const result = firstTaskResult(body);
  if (!Array.isArray(result) || result.length === 0) return null;
  const items = (result[0] as Record<string, unknown> | null)?.items;
  if (!Array.isArray(items)) return null;

  const rows: RelatedKeywordItem[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) return null;
    const depth = (item as Record<string, unknown>).depth;
    const keywordData = (item as Record<string, unknown>).keyword_data;
    if (typeof depth !== "number" || typeof keywordData !== "object" || keywordData === null) return null;

    const keyword = (keywordData as Record<string, unknown>).keyword;
    const keywordInfo = (keywordData as Record<string, unknown>).keyword_info;
    const keywordProperties = (keywordData as Record<string, unknown>).keyword_properties;
    if (typeof keyword !== "string" || typeof keywordInfo !== "object" || keywordInfo === null) return null;

    const searchVolume = (keywordInfo as Record<string, unknown>).search_volume;
    const cpc = (keywordInfo as Record<string, unknown>).cpc;
    const keywordDifficulty =
      typeof keywordProperties === "object" && keywordProperties !== null
        ? (keywordProperties as Record<string, unknown>).keyword_difficulty
        : null;
    if (!isNumberOrNull(searchVolume) || !isNumberOrNull(cpc) || !isNumberOrNull(keywordDifficulty)) return null;

    rows.push({ keyword, depth, searchVolume, cpc, keywordDifficulty });
  }
  return rows;
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || v === undefined || typeof v === "number";
}

function firstTaskResult(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return null;
  const tasks = (body as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const task = tasks[0] as Record<string, unknown> | null;
  if (!task || (task.status_code !== undefined && task.status_code !== 20000)) return null;
  return task?.result ?? null;
}

export async function getLatestSemanticKeywords(vertical: string): Promise<RelatedKeywordResult[]> {
  const rows = await prisma.semanticKeyword.findMany({ where: { vertical } });
  return latestPerKeyword(rows).map((r) => ({
    keyword: r.keyword,
    searchVolume: r.searchVolume,
    cpc: r.cpc,
    keywordDifficulty: r.keywordDifficulty,
  }));
}
