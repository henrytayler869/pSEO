import { prisma } from "@/lib/db/prisma";

/**
 * Candidate keyword phrasings per vertical.
 *
 * Why this exists: the original single pattern — `"{vertical} {place}"` —
 * silently produced a long-tail phrase instead of the head term for some
 * places. Measured live 2026-09-07 with scripts/probe-keywords.ts:
 *
 *   "moving services chicago"       480 SV / KD 37
 *   "movers chicago"             14,800 SV / KD 25   (30.8x volume, LOWER difficulty)
 *   "moving services los angeles"   320 SV / KD 18
 *   "movers los angeles"          9,900 SV / KD  7   (30.9x volume)
 *
 * That distortion doesn't stay in keyword-land: MarketScore multiplies by
 * searchVolume, so Chicago's markets were being ranked on ~3% of their real
 * demand, which skews market ranking inside a niche AND the cross-niche
 * avgScore comparison.
 *
 * IMPORTANT — every template list here must be MEASURED, not guessed. A
 * plausible-sounding synonym that nobody actually searches would replace a
 * real number with a worse one, which is worse than the bug it fixes. A
 * vertical with no entry falls back to the single canonical pattern, which
 * is exactly the previous behaviour — no silent change for unmeasured
 * verticals. To add one: run scripts/probe-keywords.ts on a handful of that
 * vertical's real places first, then add the templates that actually won.
 *
 * `{place}` is substituted with the sanitized place name.
 * Overridable at runtime via AppConfig key "keywordTemplatesByVertical"
 * (same override pattern as estConversionRateByVertical / candidateNiches).
 */
// Every list below was measured (scripts/probe-keywords.ts) against Houston,
// Charlotte and Boise on 2026-09-07 — a large, a mid-size and a small
// market, so a winner that only holds in big cities can't sneak in.
//
// CRITICAL RULE, learned from this round: a higher-volume phrase is only a
// valid candidate if it means THE SAME SERVICE. Several verticals had a
// much bigger term that describes a *different business*:
//
//   tax-relief         "tax attorney"       1,730 vs 30 SV  (58x) — a lawyer, not a relief service
//   mortgage-refinance "mortgage broker"      800 vs 50 SV  (16x) — origination, not refinancing
//   senior-care        "assisted living"    5,180 vs 620 SV (8x)  — a facility, not in-home care
//   debt-relief        "debt consolidation"   120 vs 20 SV  (6x)  — a different product
//
// Those are NOT added. Chasing them would silently redefine what the niche
// sells, and every page built on them would answer a question the business
// can't service. They're reported to the operator as a business decision
// instead — see the run notes in scripts/refresh-keywords-for-vertical.ts.
//
// medicare-plans is left alone for a different reason: it has essentially
// no local search demand at all (best candidate measured 10 SV across all
// three cities). That's a real finding about the niche, not a phrasing bug.
const DEFAULT_TEMPLATES_BY_VERTICAL: Record<string, string[]> = {
  // "movers" and "moving companies" return identical volume to each other
  // everywhere tested, and either tie or massively beat "moving services".
  "moving-services": ["moving services {place}", "movers {place}", "moving companies {place}"],

  // Same service, different words. "car accident lawyer" ties on volume but
  // measures 6 points easier (KD 25 vs 31).
  "auto-accident-attorney": [
    "auto accident attorney {place}",
    "car accident lawyer {place}",
    "car accident attorney {place}",
  ],

  // "ac repair" / "air conditioning repair" measure 5.3x the volume of
  // "hvac repair" (3,990 vs 750). Narrower in the literal sense (cooling
  // only) but it is how people actually search for the same call-out.
  "hvac-repair": [
    "hvac repair {place}",
    "ac repair {place}",
    "air conditioning repair {place}",
    "hvac service {place}",
  ],

  // "roofing contractors" is 4.1x "roofing replacement" and describes the
  // same trade doing the same job.
  "roofing-replacement": [
    "roofing replacement {place}",
    "roof replacement {place}",
    "roofing contractors {place}",
    "roofers {place}",
  ],

  // "pest control" already wins overall, but "exterminator" is close
  // (7,480 vs 8,900) and can win city by city — worth measuring per place
  // rather than assuming the national winner holds everywhere.
  "pest-control": ["pest control {place}", "exterminator {place}", "pest control service {place}"],

  // Same volume as "solar installation" but far easier (KD 7 vs 15).
  // "solar panels" measured the same volume again, but that phrasing is
  // product-shopping intent rather than hire-an-installer intent, so it is
  // deliberately excluded.
  "solar-installation": ["solar installation {place}", "solar installers {place}"],

  // Current phrasing already wins; the alternates are kept as candidates so
  // a city where the ranking flips is caught rather than assumed away.
  "water-damage-restoration": [
    "water damage restoration {place}",
    "water damage repair {place}",
    "water damage cleanup {place}",
  ],
  "garage-door-repair": ["garage door repair {place}", "garage door service {place}"],
};

/** The canonical pattern — also the fallback for any vertical without a
 * measured template list. Identical to the original hardcoded behaviour. */
export const CANONICAL_TEMPLATE = "{vertical} {place}";

/**
 * City names that need their state appended to the keyword — listed per
 * city, naming ONLY the states that need it.
 *
 * Two different cities can share a name ("Lancaster" exists in both CA and
 * PA), and `placeForMarket` uses the city name alone, so both would
 * generate the identical keyword and their pages would cannibalise each
 * other. The obvious fix — always append the state for ambiguous names —
 * is WRONG, and measurably so (2026-09-07):
 *
 *   movers columbus       4,400 SV / KD 12
 *   movers columbus oh       50 SV / KD 23   ← 88x LESS volume
 *   movers portland       4,400 SV / KD 27
 *   movers portland or    4,400 SV / KD 54   ← same volume, 2x the difficulty
 *
 * People don't type the state for the city they mean by default, so
 * suffixing the dominant city repeats the "moving services chicago"
 * long-tail mistake in reverse. But the SECONDARY city does have its own
 * real, smaller term:
 *
 *   movers lancaster      1,000 SV   (= "movers lancaster pa", same query)
 *   movers lancaster ca     210 SV   ← real, separate, smaller market
 *   movers columbus ga      880 SV
 *   movers portland me      720 SV
 *
 * So the rule is: the dominant city keeps the bare name, the others carry
 * the state. Which one is dominant CANNOT be derived reliably from volume
 * alone (Columbus OH is clearly the dominant Columbus, yet "movers columbus
 * oh" measures near-zero), so entries here are decided by measurement plus
 * judgement, never inferred at runtime.
 *
 * Only one ambiguous name exists across the current 300 Locations, so this
 * is deliberately a small explicit list rather than an automated mechanism.
 * scripts/refresh-keywords-for-vertical.ts warns when it finds an ambiguous
 * city name that is missing from this list.
 * Overridable via AppConfig key "placesNeedingStateSuffix".
 */
const DEFAULT_PLACES_NEEDING_STATE_SUFFIX: Record<string, string[]> = {
  // "movers lancaster" resolves to Lancaster, PA (identical volume), so PA
  // keeps the bare name and CA takes the suffixed term it genuinely has.
  lancaster: ["CA"],
};

export async function getPlacesNeedingStateSuffix(): Promise<Record<string, string[]>> {
  const config = await prisma.appConfig.findUnique({ where: { key: "placesNeedingStateSuffix" } });
  const overrides =
    config && typeof config.value === "object" && config.value !== null
      ? (config.value as Record<string, string[]>)
      : {};
  return { ...DEFAULT_PLACES_NEEDING_STATE_SUFFIX, ...overrides };
}

/**
 * Counties whose colloquial name is itself a real search term, mapped
 * countyFips -> the name people actually type.
 *
 * Needed because the keyword place comes from the Census "Place" name, and
 * a Place can be far larger than what people search by. All 48 NYC zips
 * carry Place "New York", so every borough inherited "movers new york"
 * (18,100 SV / KD 49) — while each borough has its own real and much
 * easier term (measured 2026-09-07):
 *
 *   movers brooklyn       6,600 SV / KD 14
 *   movers queens         2,400 SV / KD  2
 *   movers bronx          1,300 SV / KD  0
 *   movers manhattan      1,000 SV / KD 31
 *   movers staten island     10 SV        ← real, but too small to matter
 *
 * The county NAME is not usable here — nobody searches "movers kings
 * county". Only the colloquial borough name works, and that mapping is
 * knowledge, not data, so it is written down explicitly rather than
 * derived. Deliberately small: this applies where a sub-city geography is
 * genuinely how people search, which is measured, not assumed. Do not add
 * a county here without probing its term first — "movers cook county" and
 * "movers harris county" both measured NO DATA.
 *
 * Overridable via AppConfig key "countySearchPlaces".
 */
const DEFAULT_COUNTY_SEARCH_PLACES: Record<string, string> = {
  "36047": "brooklyn", // Kings County
  "36005": "bronx", // Bronx County
  "36081": "queens", // Queens County
  "36061": "manhattan", // New York County
  "36085": "staten island", // Richmond County
};

export async function getCountySearchPlaces(): Promise<Record<string, string>> {
  const config = await prisma.appConfig.findUnique({ where: { key: "countySearchPlaces" } });
  const overrides =
    config && typeof config.value === "object" && config.value !== null
      ? (config.value as Record<string, string>)
      : {};
  return { ...DEFAULT_COUNTY_SEARCH_PLACES, ...overrides };
}

/** Appends the state only where measurement says this city needs it. */
export function applyStateSuffix(
  place: string,
  state: string,
  needing: Record<string, string[]>
): string {
  const states = needing[place.toLowerCase()];
  if (!states || !states.includes(state.toUpperCase())) return place;
  return `${place} ${state.toLowerCase()}`;
}

export async function getKeywordTemplates(vertical: string): Promise<string[]> {
  const config = await prisma.appConfig.findUnique({ where: { key: "keywordTemplatesByVertical" } });
  const overrides =
    config && typeof config.value === "object" && config.value !== null
      ? (config.value as Record<string, string[]>)
      : {};
  const merged = { ...DEFAULT_TEMPLATES_BY_VERTICAL, ...overrides };
  const templates = merged[vertical];
  if (!templates || templates.length === 0) return [CANONICAL_TEMPLATE];
  return templates;
}

/** Renders one template into a real keyword. Both `{place}` and
 * `{vertical}` are supported so the canonical fallback works unchanged. */
export function renderTemplate(template: string, vertical: string, place: string): string {
  return template.replaceAll("{vertical}", vertical.replace(/-/g, " ")).replaceAll("{place}", place).trim();
}

export interface KeywordCandidateMetrics {
  keyword: string;
  searchVolume: number;
  cpc: number;
  keywordDifficulty: number;
}

/**
 * Picks the phrasing a market should actually be scored on: highest real
 * search volume wins; ties break to the lower keyword difficulty (a genuine
 * tie means the search engine treats them as the same query, so the easier
 * one to rank for is strictly better); remaining ties keep template order,
 * which makes the choice deterministic and re-runnable.
 */
/**
 * Terms a published site has already claimed for a page of its own.
 *
 * A market assigned one of these would compete with that page on the same
 * query, and neither side would notice: the site checks collisions only
 * within its own market inventory, and keyword research here checks only
 * against other markets. The overlap between the two was nobody's job.
 *
 * Registered by exact normalised phrase, not by substring. A substring rule
 * would silently swallow "local moving services in tulsa" — a phrase that is
 * genuinely a market's, not the pillar's — and the market would lose its
 * keyword to a rule nobody could see firing.
 *
 * 2026-09-09: the two pillar pages on atmovingservices.com. Verified clean at
 * the time — 0 markets targeting either term, 0 overlapping pairs — so this
 * costs nothing today and exists to keep it that way.
 */
const RESERVED_TERMS = new Map<string, string>([
  ["moving services cross country", "trang pillar /long-distance-moving"],
  ["local moving services", "trang pillar /local-moving"],
]);

function normaliseTerm(keyword: string): string {
  return keyword.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The reserved list, for publishing to sites that must enforce the same rule.
 * Exported from the same Map the picker uses — a second hand-written copy in
 * the rules endpoint would be exactly the drift this whole mechanism exists to
 * prevent. */
export function listReservedTerms(): { term: string; ownedBy: string }[] {
  return [...RESERVED_TERMS.entries()].map(([term, ownedBy]) => ({ term, ownedBy }));
}

/** Who has claimed this exact phrase, or null when nobody has. */
export function reservedBy(keyword: string): string | null {
  return RESERVED_TERMS.get(normaliseTerm(keyword)) ?? null;
}

export function pickBestCandidate(candidates: KeywordCandidateMetrics[]): KeywordCandidateMetrics | null {
  // Reserved phrases are dropped BEFORE the comparison, not flagged after it.
  // A term that must not be used is not a candidate, and letting it into the
  // comparison would sometimes make it the winner and then require someone
  // downstream to notice and undo that.
  const usable = candidates.filter((c) => reservedBy(c.keyword) === null);
  if (usable.length === 0) return null;
  candidates = usable;

  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => {
    if (c.searchVolume !== best.searchVolume) return c.searchVolume > best.searchVolume ? c : best;
    if (c.keywordDifficulty !== best.keywordDifficulty) return c.keywordDifficulty < best.keywordDifficulty ? c : best;
    return best;
  });
}
