/**
 * The link between a registered Domain and a Publisher Website.
 *
 * DERIVED, not stored. There is no foreign key between the two tables and this
 * deliberately does not add one: the relation is "these are the same host",
 * and that fact is already written in both rows. A `domainId` column would be
 * a second copy of it, and two copies of one fact drift — someone edits the
 * website URL, the column keeps pointing at the old domain, and the UI shows a
 * link that is no longer true while looking authoritative.
 *
 * Deriving it means the link is always exactly as true as the data. Change the
 * URL to a different host and the link disappears, which is correct: it is not
 * that site any more.
 */

/**
 * Host, lowercased, `www.` stripped, port and path removed.
 *
 * `www.` is stripped because a Domain is registered as the apex
 * (`example.com`) while a Website's URL may carry the www form, and treating
 * those as different sites would leave every domain looking unconnected.
 */
export function normalizeHost(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "").split("/")[0];
  }
}

export interface LinkedWebsite {
  id: string;
  name: string;
  url: string;
}

/**
 * Finds the Publisher website for a domain, if one exists.
 *
 * Exact host match only. A subdomain is a different site — `blog.example.com`
 * has its own Search Console property and its own analytics — so matching by
 * suffix would report one website as belonging to a domain whose numbers it
 * does not describe.
 */
export function findWebsiteForDomain<T extends { id: string; name: string; url: string }>(
  domainName: string,
  websites: T[]
): LinkedWebsite | null {
  const wanted = normalizeHost(domainName);
  if (!wanted) return null;
  const match = websites.find((w) => normalizeHost(w.url) === wanted);
  return match ? { id: match.id, name: match.name, url: match.url } : null;
}
