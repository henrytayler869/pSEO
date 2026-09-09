import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

export interface RequiredPageStatus {
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

  return Promise.all(
    required.map(async (req) => {
      const failures: string[] = [];
      for (const path of req.paths) {
        try {
          const { status } = await fetchWithCurlFallback(`${origin}${path}`);
          if (status === 200) {
            return {
              id: req.id,
              label: req.label,
              foundAt: path,
              tried: req.paths,
              status: "ok" as const,
              detail: `${path} trả 200.`,
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
        status: allUnreachable ? ("unknown" as const) : ("missing" as const),
        detail: failures.join(" · "),
        why: req.why,
      };
    })
  );
}
