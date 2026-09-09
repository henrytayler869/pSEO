import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

export interface RequiredPageStatus {
  /**
   * Whether anything on the site links to the page.
   *
   * A separate question from "does it answer 200", and the reason it is asked
   * separately: a required page nobody links to is reachable by a crawler and
   * invisible to a person. The checklist goes green and helps no one.
   *
   * Same shape as is_orphan_page in the OnPage checks — a threshold of zero
   * catches the page that fell out entirely and misses the page that is merely
   * starved. Here, "200" catches the page that does not exist and misses the
   * page nobody can get to.
   *
   * null when it could not be determined (the sampled page did not load),
   * which is not the same as false.
   */
  linkedFrom: boolean | null;
  id: string;
  label: string;
  /** The path that answered, or null when none did. */
  foundAt: string | null;
  /** Every path tried, so a miss shows what was looked for rather than only
   * that something was not found. */
  tried: string[];
  status: "ok" | "missing" | "unknown";
  detail: string;
  why: string;
}

/**
 * Checks a live site for the pages every publisher must serve.
 *
 * Done from HERE rather than inside each publisher's build, and that choice is
 * the point. Content rules have to run in the build because only the build
 * sees the text before it ships. These pages are public, so Head Quarter can
 * simply ask — which means a new publisher inherits the check without writing
 * one, and cannot forget a check it never had to implement.
 *
 * A path that answers 200 counts. Anything else — 404, 500, a network failure
 * — is reported with its own reason, because "the page does not exist" and
 * "the site did not answer" call for different work and only one of them is
 * about the page.
 */
export async function checkRequiredPages(
  siteUrl: string,
  required: { id: string; label: string; paths: string[]; why: string }[]
): Promise<RequiredPageStatus[]> {
  const origin = siteUrl.replace(/\/+$/, "");

  /**
   * One page's HTML, used to ask which required paths are actually linked.
   *
   * The home page, because a site that links its policy pages anywhere links
   * them from there — they belong in a footer, and a footer that skips the
   * home page is not a footer. Sampling every page instead would be more
   * thorough and would cost one request per page for an answer that does not
   * change.
   *
   * Requested with Accept: text/html deliberately. This site sits behind
   * Cloudflare, which serves a DIFFERENT document for Accept: * / * — measured
   * 2026-09-10: 28,309 bytes without the injected beacon versus 28,676 with
   * it. Asking with the default header would inspect a document no browser
   * ever receives, and any conclusion drawn about its links would be about a
   * page nobody visits.
   */
  let homeHtml: string | null = null;
  try {
    const response = await fetch(`${origin}/`, { headers: { Accept: "text/html" } });
    if (response.ok) homeHtml = await response.text();
  } catch {
    // Left null. Reported as "unknown" per page rather than as "not linked".
  }

  const linkedFrom = (paths: string[]): boolean | null => {
    if (homeHtml === null) return null;
    return paths.some((path) => homeHtml!.includes(`href="${path}"`));
  };

  return Promise.all(
    required.map(async (req) => {
      const failures: string[] = [];
      for (const path of req.paths) {
        try {
          const { status } = await fetchWithCurlFallback(`${origin}${path}`);
          if (status === 200) {
            const linked = linkedFrom(req.paths);
            return {
              id: req.id,
              label: req.label,
              foundAt: path,
              tried: req.paths,
              linkedFrom: linked,
              status: "ok" as const,
              detail:
                `${path} trả 200.` +
                (linked === false
                  ? " NHƯNG không trang nào link tới — crawler tới được, người đọc thì không thấy."
                  : linked === null
                    ? " Không kiểm được liên kết nội bộ (không tải được trang chủ)."
                    : ""),
              why: req.why,
            };
          }
          failures.push(`${path}: HTTP ${status}`);
        } catch (err) {
          // Kept separate from a 404 below. A site that cannot be reached at
          // all has not told us anything about its pages, and reporting that
          // as "missing" would send someone to write a page that may already
          // exist.
          failures.push(`${path}: ${err instanceof Error ? err.message.slice(0, 60) : "không gọi được"}`);
        }
      }

      const allUnreachable = failures.every((f) => !/HTTP \d/.test(f));
      return {
        id: req.id,
        label: req.label,
        foundAt: null,
        tried: req.paths,
        linkedFrom: linkedFrom(req.paths),
        status: allUnreachable ? ("unknown" as const) : ("missing" as const),
        detail: failures.join(" · "),
        why: req.why,
      };
    })
  );
}
