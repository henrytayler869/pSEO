import type { FactSet, Fact } from "./facts";

export interface ValidationIssue {
  rule: string;
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

/** How far a written number may sit from a measured one and still count as
 * the same figure. Covers honest rounding ("$549,400" -> "about $549,000")
 * without letting a different number through.
 *
 * Exported because facts.ts must choose its display precision against this
 * exact number. When the two drifted apart, the prompt printed "7.9%" for a
 * measured 7.9405% — 0.51% away — and this check rejected the model for
 * quoting the figure it was handed. Same constant, one definition. */
export const ROUNDING_TOLERANCE = 0.005; // 0.5%

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
    const fv = Math.abs(f.value);
    if (fv === target) return f;
    if (fv !== 0 && Math.abs(target - fv) / fv <= ROUNDING_TOLERANCE) return f;
    // A count written in thousands ("11.5k households") or a figure written
    // in millions ("$6.34 billion") is the same fact, differently scaled.
    for (const scale of [1_000, 1_000_000, 1_000_000_000]) {
      if (fv !== 0 && Math.abs(target * scale - fv) / fv <= ROUNDING_TOLERANCE) return f;
    }
  }
  return null;
}

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
export function validateGeneratedText(text: string, factSet: FactSet): ValidationResult {
  const issues: ValidationIssue[] = [];

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
