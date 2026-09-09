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
export function deriveWpAdminUrl(wpApiBaseUrl: string | null, siteUrl: string): WpAdminLink {
  // Strip the REST path back to the WordPress origin. Matching /wp-json rather
  // than assuming the full /wp-json/wp/v2 suffix: some installs proxy the REST
  // API under a different namespace depth, and cutting a fixed number of
  // segments would silently produce a wrong origin for them.
  const base = wpApiBaseUrl ?? siteUrl;
  const origin = base.replace(/\/wp-json(\/.*)?$/, "").replace(/\/+$/, "");
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
