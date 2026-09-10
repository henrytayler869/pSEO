import type { FactSet, Fact } from "./facts";

/**
 * Every rule this validator can emit — the ONE list.
 *
 * Not a convenience. The coverage assertion in the test suite used to keep its
 * own parallel copy, and when wrong_unit was added the suite printed "cả 4
 * luật đều có ca làm nó kêu" and stayed green. That sentence was TRUE: those
 * four rules did each have a firing case. It simply said nothing about the
 * fifth. A false claim can be contradicted; a true claim that does not cover
 * the new thing offers nothing to contradict.
 *
 * With `rule` typed against this union, a new rule cannot be emitted until it
 * is registered here, and the suite reads the same list — so it cannot be
 * proven-by-omission again. The list and the check can no longer disagree,
 * because there is only one of them.
 */
export const VALIDATOR_RULES = [
  "unsupported_number",
  "wrong_unit",
  "scope_overclaim",
  "worded_proportion",
  "invented_place_name",
] as const;

export type ValidatorRule = (typeof VALIDATOR_RULES)[number];

export interface ValidationIssue {
  rule: ValidatorRule;
  detail: string;
}

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
}

/** Numbers that carry no factual claim — years, small counts used
 * rhetorically ("three things to check"), and percentages of 100. Kept
 * deliberately narrow: the safer failure here is rejecting a fine sentence,
 * not admitting an invented figure. */
const ALWAYS_ALLOWED = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 100]);

/**
 * How far the PROMPT may round a measured value when printing it.
 *
 * No longer a tolerance the validator accepts — see matchesFact. It now has
 * exactly one job: facts.ts picks display precision against this number, so a
 * figure handed to the model is never more than this far from the measurement
 * behind it. The validator's job is the separate question of whether the model
 * wrote back what it was given.
 *
 * Kept as one exported constant because the two used to drift apart: the
 * prompt printed "7.9%" for a measured 7.9405% — 0.51% away — and the check
 * rejected the model for quoting the figure it had just been handed.
 */
export const ROUNDING_TOLERANCE = 0.005; // 0.5%

/**
 * The numbers a fact may legitimately appear as.
 *
 * Exactly two: the measured value, and the value as the prompt PRINTED it.
 * Nothing between them, and nothing near them.
 *
 * This replaced a relative 0.5% window, and the reason is a divergence that
 * was already armed. The published site runs its own validator that accepts
 * only displayed roundings — for a fact of $808,500 it allows "808,500" and
 * "$8.1M" and refuses everything else. A 0.5% window here accepts "about
 * $812,000", which is a number nobody measured and nobody printed. That
 * passage would pass HERE, generate, cache, cost money — and then be dropped
 * by the site, leaving a page silently missing its interpretation with no
 * error anywhere connecting the two.
 *
 * The stricter rule is also the more honest one on its own terms: a figure
 * that has been rounded a second time, by the model rather than by the
 * pipeline, is a figure whose provenance ends at the model.
 *
 * Costs nothing today — the current 127 pages all validate — and prevents
 * paying to generate text the site will discard.
 */
function allowedValuesFor(fact: Fact): number[] {
  /**
   * ONLY what the prompt printed, and reductions of it. NOT the raw measured
   * value.
   *
   * Found by a question from the published site: does a model get to write
   * MORE decimals than it was shown? Measuring the answer exposed an
   * inconsistency here — the rule rejected "7.62%" for a fact displayed as
   * "7.6%" (two invented digits) while accepting "7.6234%" (four invented
   * digits), purely because the second happened to equal the raw value.
   *
   * The model never sees the raw value: the prompt is built from f.display
   * (lib/ai/generate.ts). So any digit beyond the displayed precision is a
   * digit the model made up. Being RIGHT about a made-up digit is worse than
   * being wrong about it, because it passes.
   *
   * The asymmetry with fewer decimals is not aesthetic. Writing "7.6%" for a
   * displayed "7.63%" DISCARDS information the model was given; writing
   * "7.62%" for a displayed "7.6%" INVENTS information it was not.
   *
   * Measured before changing: dropping the raw value costs 0 of 148 cached
   * passages and leaves every published vector's verdict unchanged.
   */
  const values: number[] = [];
  // The prompt's own string, e.g. "$8.1 million" or "22.6%". Parsing it back
  // is what makes "8.1" acceptable without opening a window around 8.1.
  const printed = fact.display.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!printed) return values;

  const shown = Math.abs(Number(printed[0].replace(/,/g, "")));
  if (!Number.isFinite(shown)) return values;
  values.push(shown);

  /**
   * Also allow the displayed figure written with FEWER DECIMAL PLACES.
   *
   * CORRECTION to a rule that was too strict in one specific direction, and
   * whose error message then blamed the wrong party.
   *
   * The prompt prints mobility as "7.63%" — two decimals, chosen so the
   * printed figure stays within tolerance of the measurement. A model writing
   * "7.6% of residents" has not invented anything: it wrote the figure it was
   * handed, at the precision prose normally uses. The strict rule rejected it
   * and the message said "model tự bịa hoặc tự tính ra" — sending a reader to
   * hunt a fabrication that never happened. 16 of 148 cached passages were in
   * exactly this state.
   *
   * Reducing decimals is NOT the same as re-rounding to a coarser magnitude,
   * and that distinction is what keeps this from reopening the hole it
   * replaced. "$808,500" is displayed with zero decimals, so no reduction
   * exists and "$809,000" stays rejected. "7.7%" reduced is "7.7" or "8" —
   * never "7.75", so the double-rounding case the published site found stays
   * rejected too.
   */
  const decimals = (printed[0].split(".")[1] ?? "").length;
  for (let d = decimals - 1; d >= 0; d--) {
    values.push(Number(shown.toFixed(d)));
  }
  return values;
}

/** Float equality, not a tolerance. 0.1 + 0.2 must equal 0.3 here; 812000 must
 * not equal 808500. The epsilon is relative so it works at every magnitude. */
function sameNumber(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-9;
}

function extractNumbers(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  // Matches -1,234 / 1234.5 / 22.6% / $549,400 — the shapes that carry
  // claims. The optional minus matters: net migration is genuinely negative
  // wherever a county loses households, and dropping the sign turned a
  // correct sentence about Kings County into a rejected one.
  for (const m of text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const raw = m[0];
    const value = Number(raw.replace(/[$,%]/g, ""));
    if (Number.isFinite(value)) out.push({ raw, value });
  }
  return out;
}

function matchesFact(value: number, facts: Fact[]): Fact | null {
  // Compared on magnitude. "-11,517" and "a net loss of 11,517 households"
  // both state the same measured fact, and rejecting the second would push
  // the model toward clumsier phrasing for no gain in truthfulness.
  //
  // KNOWN LIMIT: this therefore cannot catch a reversed direction ("gained
  // 11,517" about a loss). That is a semantic error, not a numeric one, and
  // no arithmetic check can see it — the prompt carries that constraint
  // instead. Worth knowing rather than assuming the validator covers it.
  const target = Math.abs(value);
  for (const f of facts) {
    for (const allowed of allowedValuesFor(f)) {
      if (sameNumber(target, allowed)) return f;
      // A count written in thousands ("11.5k households") or a figure written
      // in millions ("$6.34 billion") is the same fact, differently scaled —
      // still an exact match, just against a scaled form of a value the
      // pipeline produced, never against a value the model invented.
      for (const scale of [1_000, 1_000_000, 1_000_000_000]) {
        if (sameNumber(target * scale, allowed)) return f;
      }
    }
  }
  return null;
}

/**
 * Words a figure may be called, mapped to the units they legitimately name.
 *
 * The validator has always checked the NUMBER and never the UNIT. That was
 * invisible while every prompt line carried its unit in the label — "people
 * who moved in from another state: 1,845" — and it opened the moment the
 * climate verticals arrived, whose prompt lines were bare numbers: "annual
 * precipitation: 8.79". A model could write inches, centimetres or millimetres
 * and every gate here passed it. A 2.54x error, in fluent prose.
 *
 * The prompt now carries the unit (lib/ai/facts.ts), which is what created the
 * standing to check this at all: before, "people" in a label was a convention
 * to hope for; now it is a value to compare against.
 *
 * Deliberately SMALL. Measured across the 148 published passages, only two
 * unit words occur next to numbers at any volume — households (143) and people
 * (118) — and everything else in that position is ordinary prose ("440 from",
 * "302 and"). A wider list would start flagging English.
 */
const UNIT_WORDS_IN_TEXT: Record<string, string[]> = {
  people: ["people/yr"],
  residents: ["people/yr"],
  households: ["households/yr"],
  inches: ["in/yr"],
  inch: ["in/yr"],
  cents: ["cents/kWh"],
  kwh: ["kWh/yr", "kWh/m2/day"],
};

/** Phrases that claim a figure describes this specific zip. */
const ZIP_SCOPE_CLAIM = /\b(in|for|within|across)\s+(zip\s*(code)?\s*)?\d{5}\b|\bthis\s+(zip|neighbou?rhood|area)\b/i;

/**
 * Proportions written as words — "one in five", "a third", "half of".
 *
 * These are numeric claims that the digit-scanner above cannot see, and they
 * are a real failure mode, not a hypothetical one: a consuming site shipped
 * "roughly one resident in five changed address" directly beside a measured
 * 29.5%. One in five is 20%. The sentence contradicted the number printed
 * next to it, and every automated check passed because no digits were
 * involved.
 *
 * Rejected outright rather than compared against the facts: a measured
 * percentage should be stated as the percentage. Paraphrasing 29.5% as a
 * fraction can only lose precision, and the rounding it invites is exactly
 * how the sentence above became false.
 */
// The "{0,3} words between" part is load-bearing, not defensive padding:
// the real sentence that shipped was "one RESIDENT in five", with a noun
// sitting between the two numbers. A pattern requiring them adjacent — the
// obvious way to write this — misses the exact case it exists to catch.
// "to" is excluded so ordinary prose ("one thing to check in three
// minutes") doesn't read as a proportion.
const WORDED_PROPORTION =
  /\b(one|two|three|four|five|six|seven|eight|nine)\s+(?:(?!to\b)[a-z]+\s+){0,3}(?:in|out\s+of)\s+(two|three|four|five|six|seven|eight|nine|ten)\b|\b(a|one)\s+(third|quarter|fifth|half)\b|\bhalf\s+(of|the)\b|\b(two|three)[- ](thirds|quarters)\b/i;

/**
 * Rejects generated text that states anything the dataset does not support.
 *
 * Two failures matter and they are different:
 *
 * 1. **Invented figures.** Any number in the text that matches no measured
 *    fact. This is the headline rule.
 *
 * 2. **Mis-scoped figures.** A number that IS real but is written as though
 *    it describes the zip when it was measured for a county or a state.
 *    The number passes rule 1 and the sentence is still false — a page
 *    saying "2,935 households moved into 10002 last year" about a
 *    New-York-County figure is stating something nobody measured.
 *
 * Runs at write time (before storing) and again at read time (before
 * serving), because the rules can tighten after text was generated and
 * cached — old text must clear today's rules, not the rules it was born
 * under.
 */
/**
 * Flags a figure called by the wrong unit.
 *
 * Only fires when the number ALREADY matches a fact — an unmatched number is
 * rule 1's job, and reporting it twice under two names would make one problem
 * look like two.
 *
 * Skips a number that matches facts with DIFFERENT units. "1,845" could be
 * people in one fact and households in another, and choosing between them
 * would be a guess dressed as a check. The whole value of this rule is that it
 * only speaks when it knows.
 */
function checkUnitWords(text: string, facts: Fact[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const m of text.matchAll(/(-?\$?[\d,]+(?:\.\d+)?%?)\s+([A-Za-z][A-Za-z-]{2,24})/g)) {
    const written = Number(m[1].replace(/[$,%]/g, ""));
    if (!Number.isFinite(written)) continue;
    const allowedUnits = UNIT_WORDS_IN_TEXT[m[2].toLowerCase()];
    if (!allowedUnits) continue;

    const matching = facts.filter((f) => matchesFact(written, [f]) !== null);

    // Rule 1 owns a number that matches nothing — reporting it here too would
    // make one problem look like two. It is also the guard for matching[0]
    // below, which is not obvious from the line and is the reason it says so:
    // deleting it does not produce a duplicate report, it throws.
    //
    // Both facts measured by mutation (2026-09-10). Removing this line: the
    // suite dies with TypeError at the matching[0] read. Removing the ambiguity
    // line below: the "4,242 under two units" case flips from pass to fail.
    // Before the two cases named in test-ai-validator.ts existed, removing
    // EITHER line left the suite green — the branches were unreached, and no
    // amount of reading them said so.
    if (matching.length === 0) continue;

    // Genuinely ambiguous — say nothing. A number matching facts with two
    // different units could be either, and choosing would be a guess wearing
    // the costume of a check.
    //
    // The mutation above proves this line RUNS. It cannot prove the line is
    // right, and the difference is not academic. The enforcing session had the
    // same silence in their unit rule, reached by accident — `units.some(...)`
    // happened to fall through — with no reason written anywhere. Their tests
    // were green, their measurements were green, and the behaviour was
    // correct. Nothing to force, because nothing was wrong yet.
    //
    // It surfaced when they read the reason written here and found they had
    // none. So: forcing a branch finds WRONG BEHAVIOUR; reading finds an
    // ABSENT REASON. Correct behaviour with no reason is correct by accident,
    // and it survives until someone changes `some` to `every` — at which point
    // no check complains, because checks only know behaviour.
    //
    // Which is why this comment is load-bearing, not decoration.
    if (units.size > 1) continue;

    const actual = [...units][0];
    if (allowedUnits.includes(actual)) continue;

    issues.push({
      rule: "wrong_unit",
      detail:
        `"${m[1]} ${m[2]}" — con số này khớp chỉ số "${matching[0].label}", đo bằng ${actual}, ` +
        `không phải ${m[2]}. Con số đúng, tên đơn vị sai, và không luật nào khác ở đây bắt được điều đó.`,
    });
  }
  return issues;
}

export function validateGeneratedText(text: string, factSet: FactSet): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Runs alongside rule 1, not inside it: rule 1 asks whether a number exists
  // in the data, this asks whether the words around it name the right thing.
  issues.push(...checkUnitWords(text, factSet.facts));

  // --- Rule 1: every stated number must trace to a measured fact ---
  const zipAsNumber = Number(factSet.zip);
  for (const { raw, value } of extractNumbers(text)) {
    if (ALWAYS_ALLOWED.has(value)) continue;
    // The zip itself is an identifier, not a quantity — naming it is how a
    // page states which place it is about.
    if (value === zipAsNumber) continue;
    // A bare 4-digit number in a plausible year range is a year, not a claim.
    if (Number.isInteger(value) && value >= 1800 && value <= 2100 && !raw.includes("$") && !raw.includes(",")) continue;
    if (!matchesFact(value, factSet.facts)) {
      issues.push({
        rule: "unsupported_number",
        detail: `"${raw}" khớp với không chỉ số đo nào — model tự bịa hoặc tự tính ra.`,
      });
    }
  }

  // --- Rule 2: wider-area figures must not be claimed for the zip ---
  const widerFacts = factSet.facts.filter((f) => f.scope !== "ZIP");
  if (widerFacts.length > 0) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!ZIP_SCOPE_CLAIM.test(sentence)) continue;
      // A sentence that names the wider area AND explicitly disclaims the
      // zip is doing exactly what rule 2 asks for. Without this, correct
      // text was rejected: "…runs about 14,800 monthly searches across
      // Chicago, IL, not the ZIP" was flagged purely because the zip
      // appeared elsewhere in the same sentence.
      // Matching the real county NAME rather than the word "county" —
      // plenty of county equivalents don't contain it. Three already in
      // this dataset: "District of Columbia", "Norfolk city", "Virginia
      // Beach city". Louisiana uses Parish and Alaska uses Borough.
      const namesTheWiderArea = widerFacts.some(
        (f) => f.scopeName && sentence.toLowerCase().includes(f.scopeName.toLowerCase())
      );
      if (
        namesTheWiderArea ||
        /\bnot (the |just the )?zip\b|\bacross the (county|parish|borough|state|metro)\b|\bcounty-wide\b/i.test(sentence)
      )
        continue;
      const zipFacts = factSet.facts.filter((f) => f.scope === "ZIP");
      for (const { value } of extractNumbers(sentence)) {
        if (ALWAYS_ALLOWED.has(value)) continue;
        // A figure that was ALSO measured for this zip is legitimately
        // claimable for it, even if some county figure happens to land on
        // the same number. Without this, coincidence alone rejected correct
        // sentences: ZIP 11219's own mobility rate is 6.32%, close enough to
        // a county figure that rule 2 read a true statement as an
        // overclaim. 16 such collisions across 3,324 measured facts — rare,
        // but they reject text that is right, which is the worse error here.
        if (matchesFact(value, zipFacts)) continue;
        const fact = matchesFact(value, widerFacts);
        if (fact) {
          issues.push({
            rule: "scope_overclaim",
            detail:
              `Câu "${sentence.trim().slice(0, 90)}…" gán số ${fact.value} cho ZIP ${factSet.zip}, ` +
              `nhưng chỉ số này đo ở cấp ${fact.scope}${fact.scopeName ? ` (${fact.scopeName})` : ""}.`,
          });
        }
      }
    }
  }

  // --- Rule 3: no proportions written as words ---
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const m = WORDED_PROPORTION.exec(sentence);
    if (m) {
      issues.push({
        rule: "worded_proportion",
        detail:
          `Câu "${sentence.trim().slice(0, 90)}…" dùng tỷ lệ viết bằng chữ ("${m[0]}"). ` +
          `Phải nêu thẳng con số phần trăm đã đo — diễn đạt lại thành phân số chỉ làm mất độ chính xác và dễ mâu thuẫn với số in ngay cạnh.`,
      });
    }
  }

  // --- Rule 4: never name a place the dataset has no name for ---
  // Only checked when the county name is genuinely missing, which is the
  // exact case where a model is most tempted to supply one.
  if (factSet.county === null) {
    // "County" is only the most common county-equivalent suffix, not the
    // only one — Louisiana has Parishes, Alaska has Boroughs, and this
    // dataset already contains "District of Columbia", "Norfolk city" and
    // "Virginia Beach city". A rule that only knows the word "county"
    // would let an invented "Orleans Parish" straight through, in exactly
    // the situation where the model is most tempted to supply a name.
    const namesACounty = /\b[A-Z][a-z]+\s+(County|Parish|Borough)\b/.test(text);
    if (namesACounty) {
      issues.push({
        rule: "invented_place_name",
        detail: `Text gọi tên một county, nhưng dataset không có tên county cho ZIP ${factSet.zip} (phải viết "the county containing ZIP ${factSet.zip}").`,
      });
    }
  }

  return { passed: issues.length === 0, issues };
}
