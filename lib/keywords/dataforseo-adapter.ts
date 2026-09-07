import type { KeywordMetricsAdapter, MarketRef, KeywordMetricResult } from "./types";
import { getKeywordTemplates, renderTemplate, pickBestCandidate, getPlacesNeedingStateSuffix, applyStateSuffix } from "./patterns";

const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";

// DataForSEO's well-known numeric code for "United States" (Google Ads /
// DataForSEO Labs location reference) — this is a stable platform constant,
// not something scoped per-account, so it's safe to hardcode alongside the
// "country=us" assumption the rest of Module 1 already makes.
const US_LOCATION_CODE = 2840;
const LANGUAGE_CODE = "en";
const CHUNK_SIZE = 1000; // DataForSEO's documented max keywords per request

/**
 * DataForSEO adapter, keyed by DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD (HTTP
 * Basic Auth — different from Ahrefs' bearer token).
 *
 * Unlike Ahrefs' single "keywords overview" endpoint, DataForSEO splits
 * search volume/CPC and keyword difficulty across two separate products:
 *   - Keywords Data API  -> POST /keywords_data/google_ads/search_volume/live
 *   - DataForSEO Labs     -> POST /dataforseo_labs/google/bulk_keyword_difficulty/live
 * so one fetchForMarkets() call makes both requests per chunk and merges the
 * results by keyword. Both endpoint shapes were confirmed against DataForSEO's
 * current published docs (docs.dataforseo.com) as of writing, but — same
 * caveat as every other adapter in this codebase — this was written without
 * a live credential to test against. Response parsing validates the exact
 * fields used and throws on anything unexpected rather than guessing, so a
 * shape mismatch surfaces as a collector error, not silent bad data.
 */
export class DataForSeoKeywordAdapter implements KeywordMetricsAdapter {
  sourceName = "dataforseo_api";

  private readonly authHeader: string;

  constructor(login: string, password: string) {
    this.authHeader = `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
  }

  /**
   * Measures every candidate phrasing for each market's place and keeps the
   * one that actually has the demand (lib/keywords/patterns.ts explains why
   * a single hardcoded phrasing was wrong).
   *
   * Candidates are deduplicated across markets before being sent: search
   * volume depends only on (vertical, place), so the 582 moving-services
   * markets collapse to 243 distinct places — measuring per market instead
   * would bill DataForSEO for the same phrase dozens of times and return
   * the identical number every time.
   *
   * Exactly ONE result per market is returned, same as before. That matters:
   * computeTrafficValues() SUMS searchVolume across a market's keywords, so
   * emitting two phrasings of the same query here would double-count the
   * demand rather than describe it twice.
   */
  async fetchForMarkets(markets: MarketRef[]): Promise<KeywordMetricResult[]> {
    // place is what the phrasing varies over; markets sharing a place share
    // every candidate and every measurement.
    const candidatesByMarket = new Map<string, { market: MarketRef; candidates: string[] }>();
    const allCandidates = new Set<string>();

    const needingStateSuffix = await getPlacesNeedingStateSuffix();
    for (const market of markets) {
      const place = applyStateSuffix(placeForMarket(market), market.state, needingStateSuffix);
      const templates = await getKeywordTemplates(market.vertical);
      const candidates = templates.map((t) => renderTemplate(t, market.vertical, place));
      candidatesByMarket.set(market.marketIdentityId, { market, candidates });
      for (const c of candidates) allCandidates.add(c);
    }

    const distinct = [...allCandidates];
    const volumeByKeyword = new Map<string, { searchVolume: number; cpc: number }>();
    const difficultyByKeyword = new Map<string, number>();

    for (let i = 0; i < distinct.length; i += CHUNK_SIZE) {
      const chunk = distinct.slice(i, i + CHUNK_SIZE);
      const [vol, kd] = await Promise.all([this.fetchSearchVolume(chunk), this.fetchKeywordDifficulty(chunk)]);
      for (const [k, v] of vol) volumeByKeyword.set(k, v);
      for (const [k, v] of kd) difficultyByKeyword.set(k, v);
    }

    const results: KeywordMetricResult[] = [];
    for (const { market, candidates } of candidatesByMarket.values()) {
      const measured = candidates
        .map((keyword) => {
          const normalized = normalizeKeyword(keyword);
          const volume = volumeByKeyword.get(normalized);
          // A market needs a volume/CPC row to be worth scoring at all; a
          // missing KD is tolerated as 0 rather than dropping the candidate
          // entirely, since bulk_keyword_difficulty occasionally omits very
          // low-volume terms it can't compute a difficulty score for.
          if (!volume) return null;
          return {
            keyword,
            searchVolume: volume.searchVolume,
            cpc: volume.cpc,
            keywordDifficulty: difficultyByKeyword.get(normalized) ?? 0,
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      const best = pickBestCandidate(measured);
      if (!best) continue; // no candidate had data — same "skip this market" outcome as before

      results.push({
        marketIdentityId: market.marketIdentityId,
        keyword: best.keyword,
        searchVolume: best.searchVolume,
        keywordDifficulty: best.keywordDifficulty,
        cpc: best.cpc,
      });
    }

    return results;
  }

  private async fetchSearchVolume(keywords: string[]): Promise<Map<string, { searchVolume: number; cpc: number }>> {
    const response = await fetch(`${DATAFORSEO_BASE_URL}/keywords_data/google_ads/search_volume/live`, {
      method: "POST",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keywords, location_code: US_LOCATION_CODE, language_code: LANGUAGE_CODE },
      ]),
    });
    if (!response.ok) {
      throw new Error(
        `Yêu cầu DataForSEO (search_volume) thất bại: ${response.status} ${response.statusText}. Hủy import thay vì nhập một phần.`
      );
    }

    const body: unknown = await response.json();
    const rows = extractSearchVolumeRows(body);
    if (!rows) {
      const taskError = taskErrorMessage(body);
      throw new Error(
        taskError ??
          "Phản hồi DataForSEO (search_volume) không đúng cấu trúc mong đợi (schema drift) — hủy import thay vì ghi dữ liệu chưa xác thực."
      );
    }

    const map = new Map<string, { searchVolume: number; cpc: number }>();
    for (const row of rows) {
      // DataForSEO returns search_volume/cpc: null (not a missing row) for
      // keywords it has no data for — very common for a narrow niche+city
      // combination in a small town. That's a legitimate "no data" result,
      // not a malformed response, so it's skipped here the same way a
      // missing map entry already is in fetchForMarkets() (`if (!volume)`).
      if (row.search_volume === null || row.cpc === null) continue;
      map.set(normalizeKeyword(row.keyword), { searchVolume: row.search_volume, cpc: row.cpc });
    }
    return map;
  }

  private async fetchKeywordDifficulty(keywords: string[]): Promise<Map<string, number>> {
    const response = await fetch(`${DATAFORSEO_BASE_URL}/dataforseo_labs/google/bulk_keyword_difficulty/live`, {
      method: "POST",
      headers: { Authorization: this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keywords, location_code: US_LOCATION_CODE, language_code: LANGUAGE_CODE },
      ]),
    });
    if (!response.ok) {
      throw new Error(
        `Yêu cầu DataForSEO (bulk_keyword_difficulty) thất bại: ${response.status} ${response.statusText}. Hủy import thay vì nhập một phần.`
      );
    }

    const body: unknown = await response.json();
    const items = extractDifficultyItems(body);
    if (!items) {
      const taskError = taskErrorMessage(body);
      throw new Error(
        taskError ??
          "Phản hồi DataForSEO (bulk_keyword_difficulty) không đúng cấu trúc mong đợi (schema drift) — hủy import thay vì ghi dữ liệu chưa xác thực."
      );
    }

    const map = new Map<string, number>();
    for (const item of items) {
      // Same "null means no data, not malformed" reasoning as search volume
      // above — left out of the map so the `difficulty ?? 0` fallback in
      // fetchForMarkets() applies instead of poisoning the whole batch.
      if (item.keyword_difficulty === null) continue;
      map.set(normalizeKeyword(item.keyword), item.keyword_difficulty);
    }
    return map;
  }
}

/** The place half of a keyword. Every candidate phrasing for a market
 * varies only in the wording around this, which is why candidates can be
 * deduplicated per place rather than per market. */
function placeForMarket(m: MarketRef): string {
  // No city name (real Census-sourced zip, TRAFFIC mode) — fall back to
  // "state zip" rather than guessing a city, since a wrong city name would
  // silently query the wrong local search term.
  return m.city ? sanitizePlaceForKeyword(m.city) : `${m.state.toLowerCase()} ${m.zip}`;
}

// Real, hit-live-and-broke case (2026-09-05): Census's official place name
// for consolidated city-county governments can be legally correct but
// keyword-hostile, e.g. "Nashville-Davidson metropolitan government
// (balance)" — DataForSEO's search_volume endpoint rejects the entire batch
// (not just that one keyword) on invalid characters, so one bad city name
// silently blocks every zip in the request. Strips a trailing parenthetical
// (the "(balance)" part), then keeps only the text before the first
// hyphen/slash (the actual city name in these compound consolidated-gov
// names, e.g. "Nashville-Davidson" -> "Nashville", "Louisville/Jefferson
// County" -> "Louisville") — a real simplification, not a fabricated name.
function sanitizePlaceForKeyword(city: string): string {
  const withoutParenthetical = city.replace(/\s*\([^)]*\)\s*$/, "");
  const firstSegment = withoutParenthetical.split(/[-/]/)[0].trim();
  return firstSegment.toLowerCase();
}

function normalizeKeyword(k: string): string {
  return k.trim().toLowerCase();
}

interface SearchVolumeRow {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
}

// tasks[0].result is a flat array of per-keyword rows for this endpoint —
// no extra "items" nesting (unlike the Labs endpoint below). search_volume
// and cpc are legitimately `null` (not missing) when DataForSEO has no data
// for a keyword — a real, common outcome for a narrow niche+city phrase in
// a small town, not a sign the response shape changed. Only a field that's
// neither the expected type nor null counts as schema drift.
function extractSearchVolumeRows(body: unknown): SearchVolumeRow[] | null {
  const result = firstTaskResult(body);
  if (!Array.isArray(result)) return null;

  const rows: SearchVolumeRow[] = [];
  for (const r of result) {
    if (
      typeof r !== "object" ||
      r === null ||
      typeof (r as Record<string, unknown>).keyword !== "string" ||
      !isNumberOrNull((r as Record<string, unknown>).search_volume) ||
      !isNumberOrNull((r as Record<string, unknown>).cpc)
    ) {
      return null; // one malformed row is enough to call this schema drift
    }
    rows.push(r as SearchVolumeRow);
  }
  return rows;
}

interface DifficultyItem {
  keyword: string;
  keyword_difficulty: number | null;
}

// tasks[0].result[0].items is where Labs endpoints nest their per-keyword
// rows — one extra level deeper than the Keywords Data API above.
function extractDifficultyItems(body: unknown): DifficultyItem[] | null {
  const result = firstTaskResult(body);
  if (!Array.isArray(result) || result.length === 0) return null;
  const items = (result[0] as Record<string, unknown> | null)?.items;
  if (!Array.isArray(items)) return null;

  const rows: DifficultyItem[] = [];
  for (const item of items) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).keyword !== "string" ||
      !isNumberOrNull((item as Record<string, unknown>).keyword_difficulty)
    ) {
      return null;
    }
    rows.push(item as DifficultyItem);
  }
  return rows;
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || typeof v === "number";
}

function firstTaskResult(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return null;
  const tasks = (body as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const task = tasks[0] as Record<string, unknown> | null;
  if (!task || (task.status_code !== undefined && task.status_code !== 20000)) return null;
  return task?.result ?? null;
}

// A task-level failure (e.g. one invalid keyword in the batch, DataForSEO
// status_code 40501) is a real, specific error DataForSEO already
// diagnosed — surfacing it beats a generic "schema drift" message, which
// implies the response *shape* changed when actually our own input (or
// DataForSEO's own transient state) was rejected with a clear reason.
function taskErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const tasks = (body as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const task = tasks[0] as Record<string, unknown> | null;
  if (!task || task.status_code === undefined || task.status_code === 20000) return null;
  return `DataForSEO task lỗi (status_code ${task.status_code}): ${task.status_message ?? "không rõ"}`;
}
