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
