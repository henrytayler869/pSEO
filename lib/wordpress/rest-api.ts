import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

/**
 * WordPress's own REST API (`/wp-json/wp/v2/...`) is public and unauthenticated
 * for published content by default — every WP install ships it, no plugin or
 * credential needed, which is exactly why a headless WP+Next.js site works
 * as a content source here. Post count comes from the `X-WP-Total` response
 * header on a minimal `per_page=1` list request, not from fetching every
 * post — real WP REST API behavior (documented and stable since WP 4.7).
 */
export async function fetchPublishedPostCount(wpApiBaseUrl: string): Promise<number> {
  const url = `${wpApiBaseUrl}/posts?per_page=1&status=publish`;
  const { status, headers } = await fetchWithCurlFallback(url);
  if (status !== 200) {
    throw new Error(`WordPress REST API thất bại tại ${wpApiBaseUrl}: HTTP ${status}.`);
  }
  const total = headers["x-wp-total"];
  if (total === undefined) {
    throw new Error(`Phản hồi WordPress REST API tại ${wpApiBaseUrl} thiếu header X-WP-Total (schema drift).`);
  }
  const count = Number(total);
  if (!Number.isFinite(count)) {
    throw new Error(`Header X-WP-Total tại ${wpApiBaseUrl} không phải số hợp lệ: "${total}".`);
  }
  return count;
}

/**
 * Địa chỉ REST API mà WordPress SẼ nằm ở nếu nó phục vụ ngay trên origin công
 * khai. Một GỢI Ý để điền sẵn ô nhập, KHÔNG phải một giá trị dùng được.
 *
 * KHÔNG dùng hàm này làm giá trị dự phòng cho `wpApiBaseUrl` rỗng. Đó là điều
 * duy nhất đáng nói về nó, và nó từng bị dùng đúng như thế ở năm nơi — xem
 * chú thích của `deriveWpAdminUrl` bên dưới.
 */
export function deriveWpApiBaseUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/wp-json/wp/v2`;
}

export interface WpAdminLink {
  url: string;
  /** True when the URL only resolves from inside the server — loopback or a
   * private network. The link is still shown, because it is the correct
   * address; what changes is whether clicking it can work from here. */
  serverOnly: boolean;
  /** Ready-to-run SSH forward for a serverOnly host, so the answer to "how do
   * I actually open this" is on the screen instead of in someone's memory. */
  tunnelHint: string | null;
}

/**
 * The WordPress admin URL for a site.
 *
 * Derived from wpApiBaseUrl, NOT from the public site URL, and that distinction
 * is the whole point. On a headless install the public origin serves Next.js
 * and has no /wp-admin at all — `https://example.com/wp-admin` is a 404 dressed
 * up as a working link. wpApiBaseUrl is the address WordPress actually answers
 * on, which for this project's sites is loopback on the server.
 *
 * A link that looks right and goes nowhere is worse than no link: it gets
 * clicked, it fails, and the failure looks like WordPress being down rather
 * than the address being wrong.
 */
/**
 * KHÔNG CÓ wpApiBaseUrl NGHĨA LÀ KHÔNG CÓ WORDPRESS — trả null, đừng bịa.
 *
 * Bản trước rơi về `siteUrl`, và chú thích ngay trên chính nó đã nói vì sao
 * điều đó sai: "On a headless install the public origin serves Next.js and has
 * no /wp-admin at all — https://example.com/wp-admin is a 404 dressed up as a
 * working link." Lời giải thích đúng, nằm ngay trên dòng mã làm điều ngược
 * lại — lần thứ hai trong repo này.
 *
 * Đo 19/9/2026, và người dùng là người nhìn ra trước tôi: hai site hiện WP
 * Admin khác nhau.
 *
 *   atmovingservices.com   wpApiBaseUrl = http://127.0.0.1:8090/wp-json/wp/v2
 *                          → loopback → hiện địa chỉ + lệnh tunnel. ĐÚNG, và
 *                            có WordPress thật ở đó (container atms-wp).
 *   theaccidentrecord.com  wpApiBaseUrl = https://theaccidentrecord.com/...
 *                          → host công khai → hiện link bấm được. Và:
 *
 *   theaccidentrecord.com/wp-admin   HTTP 404
 *   theaccidentrecord.com/wp-json    HTTP 404
 *
 * Site đó KHÔNG có WordPress nào cả. Giá trị kia do chính panel bịa ra lúc
 * nối site — `wpApiBaseUrlRaw || deriveWpApiBaseUrl(url)` — bằng phép nối
 * chuỗi, không ai từng hỏi WordPress có trả lời ở đó không.
 *
 * Khác biệt trên màn hình không phải chuyện giao diện: một bên là địa chỉ
 * thật cần tunnel, bên kia là một cái 404 mặc áo link.
 */
export function deriveWpAdminUrl(wpApiBaseUrl: string | null, siteUrl: string): WpAdminLink | null {
  if (!wpApiBaseUrl) return null;
  // Strip the REST path back to the WordPress origin. Matching /wp-json rather
  // than assuming the full /wp-json/wp/v2 suffix: some installs proxy the REST
  // API under a different namespace depth, and cutting a fixed number of
  // segments would silently produce a wrong origin for them.
  void siteUrl; // giữ chữ ký; site URL KHÔNG còn được dùng để đoán địa chỉ WP
  const origin = wpApiBaseUrl.replace(/\/wp-json(\/.*)?$/, "").replace(/\/+$/, "");
  const url = `${origin}/wp-admin`;

  let host = "";
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const serverOnly =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  let tunnelHint: string | null = null;
  if (serverOnly) {
    let port = "";
    try {
      port = new URL(origin).port || (origin.startsWith("https") ? "443" : "80");
    } catch {
      port = "";
    }
    tunnelHint = port ? `ssh -N -L ${port}:127.0.0.1:${port} deploy@46.225.145.196` : null;
  }

  return { url, serverOnly, tunnelHint };
}
