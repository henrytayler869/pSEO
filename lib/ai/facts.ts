import { getRealDataPointsForZipAndVertical, getCountyKeywordForZip } from "@/lib/queries/collector";
import { prisma } from "@/lib/db/prisma";
import { latestPerKeyword } from "@/lib/keywords/latest";
import { ROUNDING_TOLERANCE } from "./validate";
import { computeTrafficValues } from "@/lib/keywords/traffic-metrics";
import crypto from "node:crypto";

/**
 * One measured figure the model is allowed to mention, with the scope it is
 * allowed to claim for it.
 *
 * `scope` is the whole point: a COUNTY-resolution figure attributed to a zip
 * is a false statement even though the number itself is real, so scope
 * travels with the value everywhere instead of being reconstructed later.
 */
export interface Fact {
  key: string;
  label: string;
  value: number;
  /** How the figure is written into the prompt.
   *
   * Not cosmetic. A raw 6343845000 invites the model to write "$6.3
   * billion" — a reasonable rounding that lands 0.69% away from the real
   * value and would be REJECTED by the validator's 0.5% tolerance. Showing
   * "6.34 billion" instead gets the exact phrasing back. Raw percentages
   * are worse still: 14 decimal places of noise that costs tokens and
   * invites arbitrary rounding.
   *
   * The fix belongs here rather than in a looser tolerance — widening the
   * check to admit sloppy rounding would also admit numbers that are
   * genuinely wrong. */
  display: string;
  unit: string;
  /** "ZIP" — measured for this zip; "COUNTY"/"STATE" — measured for a wider
   * area and attributed down, so any sentence using it must say so. */
  scope: "ZIP" | "COUNTY" | "STATE";
  /** Human-readable place the figure actually describes, e.g. "Bexar County".
   * null when the source has no name for it — then the text must fall back
   * to "the county containing ZIP 78245" rather than invent one. */
  scopeName: string | null;
}

export interface FactSet {
  vertical: string;
  zip: string;
  city: string | null;
  state: string;
  county: string | null;
  facts: Fact[];
  mainKeyword: string | null;
  /** Set when the county has its own measured search term (NYC boroughs). */
  countyKeyword: string | null;
  fingerprint: string;
}

/**
 * Decimal places that keep a rounded figure inside the validator's tolerance.
 *
 * Rounding to d decimals moves a number by at most 0.5 x 10^-d, so the
 * displayed figure stays acceptable only while that error is within
 * ROUNDING_TOLERANCE of the value itself. The catch is that this is a
 * RELATIVE test: one decimal is ample for 67.4% (0.04% off) and not enough
 * for 7.9% (0.51% off, just past the line). A fixed decimal count therefore
 * cannot be right for both, and picking one silently broke the smaller
 * figures — the prompt printed "7.9%", the model quoted it exactly as
 * instructed, and validation rejected its own instruction. Roughly one
 * generation in seven, each paying for a doomed retry first.
 */
function decimalsWithinTolerance(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 1;
  let decimals = 1; // at least one — "8%" for 7.94% reads as a different figure
  while (decimals < 6 && 0.5 * Math.pow(10, -decimals) > ROUNDING_TOLERANCE * magnitude) decimals++;
  return decimals;
}

/** Renders a figure the way a writer would say it, so the model quotes it
 * back verbatim instead of inventing its own rounding. */
/**
 * The single formatter for every figure the model is shown — and now, via the
 * API, the string a consuming site should render so its page and the prompt
 * agree.
 *
 * Exported after a published site tried four times to reconstruct this from
 * observed output: 3 significant digits fit 15 of 18 samples and broke on
 * "$618.2 million". A fifth guess would have been curve-fitting, not
 * measurement. Handing over the function ends that category of work.
 */
/**
 * Display-ready unit words, for units that are NOT already carried by a symbol
 * in the formatted number.
 *
 * Added after measuring what the prompt actually says. "- annual
 * precipitation: 8.79" hands the model a bare number: it can write "8.79
 * inches", "8.79 cm" or "8.79 mm" and the validator accepts all three, because
 * the validator checks the NUMBER and has never checked the unit. A unit error
 * of 2.54x reads as fluent prose and passes every gate this project has.
 *
 * That gap was invisible for moving-services, where the labels happen to carry
 * the unit in words ("people who moved in from another state: 1,845"). It is
 * wide open for hvac-repair and roofing-replacement, whose climate figures are
 * bare — and those verticals have not been generated yet, so this is a trap
 * set rather than a fire burning.
 *
 * An empty string is a DECISION, not a gap: "1980" must not become "1980
 * year", and a count whose label already says "in the last 10 years" must not
 * repeat it. Each empty carries its reason.
 */
const UNIT_WORDS: Record<string, string> = {
  "people/yr": "people",
  "households/yr": "households",
  "in/yr": "inches",
  "degree-days/yr": "degree days",
  "cents/kWh": "cents per kWh",
  "kWh/yr": "kWh",
  "kWh/m2/day": "kWh/m²/day",
  // Empty on purpose: the number IS a year, and "1980 year" is worse than
  // "1980" in every context.
  year: "",
  // Empty on purpose: every label using this already says "in the last 10
  // years", and repeating it reads as a second, different figure.
  "count/10yr": "",
  // Already symbolised inside the formatted string.
  "%": "",
  USD: "",
  "USD/yr": "",
};

/**
 * The unit word already baked into `formatForPrompt`'s output, or "" when the
 * format carries no separate word (a percentage, a dollar amount, a year).
 *
 * Exists because consumers need to know what is ALREADY in the string before
 * they add wording of their own. Published on the API for the same reason.
 *
 * Returns null for a unit this file has no word for — distinct from "", which
 * means "deliberately no word".
 */
export function unitWordFor(unit: string): string | null {
  if (unit === "%" || unit.startsWith("USD") || unit === "year") return "";
  return UNIT_WORDS[unit] ?? null;
}

/**
 * The number exactly as `formatForPrompt` prints it, WITHOUT the unit word.
 *
 * Split out on 2026-09-10 after `formatForPrompt` started appending the unit
 * and quietly changed the meaning of the `display` field on the public API.
 * The consuming site's template appended its own unit word, as it always had,
 * and 126 pages rendered "67,282 households households" — twelve times each,
 * inside JSON-LD as well as body text.
 *
 * The lesson is not "don't change formatters". It is that ONE field was being
 * asked two different questions — "what string do I print" and "what number do
 * I print" — and a field that answers two questions answers one of them wrong
 * the moment they diverge. So now there are two fields, and neither has to
 * guess which question it was asked.
 */
export function formatNumberForPrompt(value: number, unit: string): string {
  const word = unitWordFor(unit);
  const full = formatForPrompt(value, unit);
  if (!word) return full;
  return full.endsWith(` ${word}`) ? full.slice(0, -(word.length + 1)) : full;
}

export function formatForPrompt(value: number, unit: string): string {
  if (unit === "%") return `${value.toFixed(decimalsWithinTolerance(value))}%`;
  if (unit.startsWith("USD")) {
    // Scaled figures round against the SCALED number, which is what the
    // model actually writes — "$1.01 billion" is a rounding of 1.0058, not
    // of 1,005,800,000.
    for (const [scale, word] of [
      [1_000_000_000, "billion"],
      [1_000_000, "million"],
    ] as const) {
      if (Math.abs(value) >= scale) {
        const scaled = value / scale;
        return `$${scaled.toFixed(decimalsWithinTolerance(scaled))} ${word}`;
      }
    }
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  if (unit === "year") return String(Math.round(value));

  const number = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toFixed(decimalsWithinTolerance(value));

  // An UNKNOWN unit falls through with no word rather than being guessed at.
  // A wrong unit is worse than a missing one: missing invites the reader to
  // check, wrong invites them to believe.
  const word = UNIT_WORDS[unit];
  if (word === undefined) {
    console.warn(`[facts] đơn vị "${unit}" chưa có từ hiển thị — prompt sẽ in số trần, model phải đoán đơn vị.`);
    return number;
  }
  return word ? `${number} ${word}` : number;
}

const METRIC_LABELS: Record<string, string> = {
  census_median_home_value_usd: "median home value",
  census_median_household_income_usd: "median household income",
  census_median_year_built: "median year homes were built",
  census_homeownership_rate_pct: "homeownership rate",
  census_moved_within_county: "people who moved in from elsewhere in the same county last year",
  census_moved_from_different_county: "people who moved in from another county last year",
  census_moved_from_different_state: "people who moved in from another state last year",
  census_moved_from_abroad: "people who moved in from abroad last year",
  census_mobility_rate_pct: "share of residents who lived somewhere else a year ago",
  irs_migration_inflow_households: "households that moved in (IRS returns)",
  irs_migration_outflow_households: "households that moved out (IRS returns)",
  irs_migration_net_households: "net household migration",
  irs_migration_inflow_agi_usd: "total income arriving with in-movers",
  fema_disaster_declarations_10yr: "federal disaster declarations in the last 10 years",
  solar_ac_annual_kwh: "annual solar output for a reference 4kW system",
  solar_radiation_avg_kwh_per_m2_day: "average daily solar radiation",
  solar_capacity_factor_pct: "solar capacity factor",
  noaa_heating_degree_days_annual: "annual heating degree days",
  noaa_cooling_degree_days_annual: "annual cooling degree days",
  noaa_precipitation_annual: "annual precipitation",
  eia_residential_electricity_price_cents_per_kwh: "residential electricity price",
};

/**
 * Everything the model is permitted to say about one (vertical, zip),
 * assembled ONLY from this app's own measured data. Nothing is derived,
 * rounded or combined here — a figure the model receives is a figure some
 * adapter actually collected, so the validator can later check the text
 * against exactly this list.
 *
 * Returns null when the zip has no keyword data (the API's own 404
 * condition) — there is nothing honest to write about it.
 */
export async function buildFactSet(vertical: string, zip: string): Promise<FactSet | null> {
  const identity = await prisma.marketIdentity.findUnique({
    where: { zip_vertical: { zip, vertical } },
    include: { keywordMetrics: true },
  });
  if (!identity) return null;

  const values = computeTrafficValues(identity.keywordMetrics);
  if (!values) return null;

  const location = await prisma.location.findFirst({ where: { zip } });
  const dataPoints = await getRealDataPointsForZipAndVertical(zip, vertical);
  const countyKeyword = await getCountyKeywordForZip(zip, vertical);

  const facts: Fact[] = [];

  // Search volume is DELIBERATELY NOT a fact here.
  //
  // It was, and the result was systematic: 29 of 35 generations worked it
  // into reader-facing copy ("the main keyword draws 18,100 monthly
  // searches, so it is reasonable to compare quotes"). Two things wrong
  // with that. It is internal SEO telemetry — a person looking for movers
  // has no use for it, and printing it advertises that a machine wrote the
  // page. Worse, the model kept reasoning from it: "2,400 monthly searches,
  // so expect several providers competing for the same calls" infers a
  // claim about SUPPLY from a measurement of DEMAND. That is a fabricated
  // assertion about the local market, dressed as a fact — the same category
  // as an invented number, except written in words where a numeric check
  // cannot see it.
  //
  // Removing it also removed most scope_overclaim rejections: it was the
  // main city-scoped figure the model kept trying to attach to a zip.
  //
  // It remains available to consumers through the dataset API, where it
  // belongs — as data for deciding what to build, not as page copy.

  for (const p of dataPoints) {
    facts.push({
      key: p.metric,
      label: METRIC_LABELS[p.metric] ?? p.metric,
      value: p.value,
      display: formatForPrompt(p.value, p.unit),
      unit: p.unit,
      scope: p.resolvedAtResolution === "ZIP" ? "ZIP" : p.resolvedAtResolution === "STATE" ? "STATE" : "COUNTY",
      scopeName:
        p.resolvedAtResolution === "ZIP"
          ? `ZIP ${zip}`
          : p.resolvedAtResolution === "STATE"
            ? identity.state
            : (location?.county ?? null),
    });
  }

  // The fingerprint must change whenever any figure changes, so cached text
  // can never outlive the numbers it describes.
  //
  // Sorted first, because it must ALSO not change when nothing changed. This
  // hashes a sequence, and the sequence came from an unordered database read
  // — so identical data re-collected could hash differently, look like new
  // numbers, and pay to regenerate copy that was already right. Sorting by
  // key makes the input canonical: same facts, same fingerprint, whatever
  // order the rows arrived in.
  const canonical = [...facts].map((f) => [f.key, f.value, f.scope] as const).sort((a, b) => a[0].localeCompare(b[0]));
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ vertical, zip, facts: canonical }))
    .digest("hex")
    .slice(0, 32);

  return {
    vertical,
    zip,
    city: location?.city ?? identity.city,
    state: identity.state,
    county: location?.county ?? null,
    facts,
    mainKeyword: latestPerKeyword(identity.keywordMetrics)[0]?.keyword ?? null,
    countyKeyword: countyKeyword?.keyword ?? null,
    fingerprint,
  };
}
