const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";

/** Measured from the account's own price table on 2026-09-09. Crawling is the
 * only paid step; every read below costs $0. */
export const ON_PAGE_COST_PER_PAGE_USD = 0.00015;

export class DataForSeoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataForSeoError";
  }
}

function authHeader(login: string, password: string): string {
  return `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;
}

/**
 * Unwraps DataForSEO's envelope.
 *
 * Every response is 200 with a `status_code` inside, and a task can fail while
 * the HTTP call succeeds. Reading `response.ok` alone would treat "task failed:
 * insufficient funds" as a success carrying no data, which then surfaces
 * somewhere else as an empty result — an error message about the wrong thing,
 * arriving at the wrong layer.
 */
async function callDataForSeo(
  path: string,
  auth: string,
  body: unknown | null
): Promise<Record<string, unknown>> {
  const response = await fetch(`${DATAFORSEO_BASE_URL}${path}`, {
    method: body === null ? "GET" : "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataForSeoError(`DataForSEO trả về phản hồi không phải JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  const envelope = (parsed ?? {}) as Record<string, unknown>;
  if (envelope.status_code !== 20000) {
    throw new DataForSeoError(
      `DataForSEO từ chối (status_code ${envelope.status_code}): ${envelope.status_message ?? "không rõ"}`
    );
  }
  const tasks = envelope.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new DataForSeoError("Phản hồi DataForSEO không có task nào (schema drift).");
  }
  const task = tasks[0] as Record<string, unknown>;
  if (task.status_code !== 20000 && task.status_code !== 20100) {
    throw new DataForSeoError(
      `DataForSEO task lỗi (status_code ${task.status_code}): ${task.status_message ?? "không rõ"}`
    );
  }
  return task;
}

/**
 * Starts a crawl. THIS IS THE STEP THAT COSTS MONEY.
 *
 * maxPages is required rather than defaulted, because the only defensible
 * default is one somebody chose while looking at what the site actually
 * contains. A silent default is how a crawl of a site with a calendar or a
 * faceted search runs to tens of thousands of pages.
 */
export async function createOnPageTask(
  login: string,
  password: string,
  target: string,
  maxPages: number
): Promise<string> {
  /**
   * Cloudflare serves TWO DIFFERENT DOCUMENTS for the same URL, chosen by the
   * request's Accept header.
   *
   * Measured 2026-09-10 on atmovingservices.com/data, six requests:
   *
   *   Accept: * / *              28,309 bytes, no Cloudflare beacon
   *   Accept: text/html          28,676 bytes, WITH the beacon injected at edge
   *   User-Agent                 no effect at all, either value
   *
   * Both variants return cf-cache-status HIT — Cloudflare keys its cache on
   * Accept and holds both.
   *
   * This matters for what a crawl REPORTS. A client sending Accept: * / *
   * measures a document no browser ever receives: fewer bytes, one fewer
   * third-party script, different resource counts. Every OnPage check about
   * page weight or external resources would describe that phantom document.
   *
   * DataForSEO's crawler requests HTML, so it lands on the browser variant —
   * which is the right one. Recorded here rather than assumed, because the
   * first diagnosis of this was "Cloudflare switches on User-Agent", and
   * anyone acting on that would log the User-Agent, watch it explain nothing,
   * and lose a day before suspecting Accept.
   */
  const host = new URL(target.includes("://") ? target : `https://${target}`).hostname;
  const task = await callDataForSeo("/on_page/task_post", authHeader(login, password), [
    {
      target: host,
      max_crawl_pages: maxPages,
      // Respect the site's own rules. A crawler that ignores robots.txt to
      // report "issues" is reporting on pages the site asked nobody to fetch.
      respect_sitemap: true,
      load_resources: false,
      enable_javascript: false,
    },
  ]);
  const id = task.id;
  if (typeof id !== "string" || !id) {
    throw new DataForSeoError("DataForSEO không trả về id cho task OnPage (schema drift).");
  }
  return id;
}

export interface OnPageIssue {
  key: string;
  label: string;
  severity: "error" | "warning" | "info";
  count: number;
}

export interface OnPageSummary {
  crawlProgress: string;
  pagesCrawled: number;
  pagesInQueue: number;
  onPageScore: number | null;
  issues: OnPageIssue[];
  /** Checks DataForSEO returned that this code has no label for. Reported, not
   * dropped: a check added by DataForSEO after this file was written would
   * otherwise be invisible, and invisible is indistinguishable from clean. */
  unclassified: { key: string; count: number }[];
}

/**
 * Which `page_metrics.checks` entries are PROBLEMS.
 *
 * DataForSEO returns dozens of checks and most are neutral facts, not issues:
 * `is_https` counts pages served over HTTPS, `links_external` counts pages
 * with outbound links. Listing all of them under "issues cần chỉnh sửa" would
 * bury the handful that matter under a list nobody reads — the same failure
 * this project keeps finding in its own signals.
 *
 * So issues are named explicitly, and anything unrecognised is reported in its
 * own section rather than assumed harmless.
 */
const ISSUE_CHECKS: Record<string, { label: string; severity: OnPageIssue["severity"] }> = {
  is_4xx_code: { label: "Trang trả lỗi 4xx", severity: "error" },
  is_5xx_code: { label: "Trang trả lỗi 5xx", severity: "error" },
  is_broken: { label: "Trang hỏng, không tải được", severity: "error" },
  broken_links: { label: "Có liên kết gãy", severity: "error" },
  broken_resources: { label: "Có tài nguyên gãy (ảnh/CSS/JS)", severity: "error" },
  canonical_to_redirect: { label: "Canonical trỏ vào một redirect", severity: "error" },
  recursive_canonical: { label: "Canonical lặp vòng", severity: "error" },
  duplicate_title_tag: { label: "Trùng thẻ title", severity: "error" },
  duplicate_description: { label: "Trùng meta description", severity: "error" },
  duplicate_content: { label: "Trùng nội dung", severity: "error" },
  no_title: { label: "Thiếu thẻ title", severity: "error" },
  no_h1_tag: { label: "Thiếu thẻ H1", severity: "error" },
  is_orphan_page: { label: "Trang mồ côi — không trang nào trỏ tới", severity: "error" },

  no_description: { label: "Thiếu meta description", severity: "warning" },
  title_too_long: { label: "Title quá dài", severity: "warning" },
  title_too_short: { label: "Title quá ngắn", severity: "warning" },
  no_image_alt: { label: "Ảnh thiếu thuộc tính alt", severity: "warning" },
  low_content_rate: { label: "Tỷ lệ nội dung trên mã nguồn thấp", severity: "warning" },
  high_loading_time: { label: "Thời gian tải cao", severity: "warning" },
  large_page_size: { label: "Trang quá nặng", severity: "warning" },
  size_greater_than_3mb: { label: "Trang lớn hơn 3MB", severity: "warning" },
  has_render_blocking_resources: { label: "Có tài nguyên chặn hiển thị", severity: "warning" },
  redirect_chain: { label: "Chuỗi redirect nhiều bước", severity: "warning" },
  canonical_another_page: { label: "Canonical trỏ sang trang khác", severity: "warning" },
  is_redirect: { label: "Trang là redirect", severity: "warning" },
  no_favicon: { label: "Thiếu favicon", severity: "warning" },
  no_image_title: { label: "Ảnh thiếu thuộc tính title", severity: "warning" },
  irrelevant_title: { label: "Title không khớp nội dung", severity: "warning" },
  irrelevant_description: { label: "Description không khớp nội dung", severity: "warning" },
  irrelevant_meta_keywords: { label: "Meta keywords không khớp nội dung", severity: "warning" },
  seo_friendly_url_characters_check: { label: "URL có ký tự không thân thiện SEO", severity: "warning" },
  seo_friendly_url_dynamic_check: { label: "URL động", severity: "warning" },
  seo_friendly_url_keywords_check: { label: "URL thiếu từ khoá", severity: "warning" },
  seo_friendly_url_relative_length_check: { label: "URL quá dài", severity: "warning" },
  no_doctype: { label: "Thiếu khai báo doctype", severity: "warning" },
  no_encoding_meta_tag: { label: "Thiếu thẻ khai báo encoding", severity: "warning" },
  no_content_encoding: { label: "Không nén nội dung khi truyền", severity: "warning" },
  low_readability_rate: { label: "Độ dễ đọc thấp", severity: "warning" },
  deprecated_html_tags: { label: "Dùng thẻ HTML đã lỗi thời", severity: "warning" },
  lorem_ipsum: { label: "Còn văn bản giữ chỗ lorem ipsum", severity: "error" },
  is_http: { label: "Trang phục vụ qua HTTP, không phải HTTPS", severity: "error" },
  no_favicon_check: { label: "Thiếu favicon", severity: "info" },
  meta_charset_consistency: { label: "Khai báo charset không nhất quán", severity: "warning" },
  frame: { label: "Dùng frame/iframe", severity: "info" },
  flash: { label: "Còn dùng Flash", severity: "error" },
};

/** Checks that are neutral counts, not problems. Named so they are excluded on
 * purpose rather than by accident, and so they do not land in `unclassified`. */
const NEUTRAL_CHECKS = new Set([
  "is_https",
  "is_www",
  "links_external",
  "links_internal",
  "seo_friendly_url",
  "has_html_doctype",
  "canonical",
  "has_meta_refresh_redirect",
  "https_to_http_links",
  "sitemap",
  "robots_txt",
]);

export async function fetchOnPageSummary(
  login: string,
  password: string,
  taskId: string
): Promise<OnPageSummary> {
  const task = await callDataForSeo(`/on_page/summary/${encodeURIComponent(taskId)}`, authHeader(login, password), null);
  const result = Array.isArray(task.result) ? (task.result[0] as Record<string, unknown> | undefined) : undefined;
  if (!result) {
    throw new DataForSeoError("Task OnPage chưa có kết quả nào (có thể đang khởi tạo).");
  }

  const metrics = (result.page_metrics ?? {}) as Record<string, unknown>;
  const checks = (metrics.checks ?? {}) as Record<string, unknown>;

  const issues: OnPageIssue[] = [];
  const unclassified: { key: string; count: number }[] = [];
  for (const [key, raw] of Object.entries(checks)) {
    const count = typeof raw === "number" ? raw : 0;
    if (NEUTRAL_CHECKS.has(key)) continue;
    const known = ISSUE_CHECKS[key];
    if (known) {
      // Zero-count checks are dropped here, not rendered as "0 trang" rows: a
      // list where most rows say zero is a list that gets scrolled past.
      if (count > 0) issues.push({ key, label: known.label, severity: known.severity, count });
    } else if (count > 0) {
      unclassified.push({ key, count });
    }
  }

  const severityRank = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count);
  unclassified.sort((a, b) => b.count - a.count);

  return {
    crawlProgress: typeof result.crawl_progress === "string" ? result.crawl_progress : "không rõ",
    pagesCrawled: Number(result.pages_crawled ?? 0),
    pagesInQueue: Number(result.pages_in_queue ?? 0),
    onPageScore: typeof metrics.onpage_score === "number" ? metrics.onpage_score : null,
    issues,
    unclassified,
  };
}
