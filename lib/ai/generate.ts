import { prisma } from "@/lib/db/prisma";
import { buildFactSet, type FactSet } from "./facts";
import { validateGeneratedText, type ValidationResult } from "./validate";
import { generateWithClaude } from "./anthropic";
import crypto from "node:crypto";

const MAX_ATTEMPTS = 2; // one retry: a second failure is a prompt problem, not luck

/**
 * What each trade actually does, and which neighbouring trades it does not.
 *
 * Needed because one shared prompt across 13 verticals produced copy that
 * fit none of them. Asked to write for a "service provider" with no idea
 * which service, the model reached for whatever the housing data suggested
 * — and housing data suggests maintenance. Moving-services pages came back
 * discussing "plumbing, wiring, and heating systems", "roofing", "warranty
 * terms" and "routine service": every phrase defensible for a contractor,
 * none of it relevant to hiring movers. 16 of 35 generations did this.
 *
 * The off-limits list is the load-bearing half. Naming the trade alone
 * doesn't stop the drift, because the drift comes from the data: median
 * year built genuinely does imply something about a building's systems —
 * it just isn't the mover's problem.
 */
const VERTICAL_BRIEFS: Record<string, { does: string; offLimits: string }> = {
  "moving-services": {
    does: "helping households pack, load, transport and unload their belongings when they move home",
    offLimits:
      "building maintenance or repair of any kind — plumbing, wiring, electrical, HVAC, heating, roofing, renovation — and anything about warranties, routine servicing or maintenance schedules. Movers do not repair buildings. Do not discuss the condition of a home's systems.",
  },
  "hvac-repair": {
    does: "repairing and servicing home heating, ventilation and air-conditioning systems",
    offLimits: "moving, roofing, plumbing unrelated to HVAC, and general remodelling",
  },
  "roofing-replacement": {
    does: "replacing and repairing residential roofs",
    offLimits: "interior work, moving, HVAC and plumbing",
  },
  "water-damage-restoration": {
    does: "drying out, cleaning and restoring homes after water intrusion",
    offLimits: "routine remodelling, moving, and roof replacement unrelated to the water event",
  },
  "garage-door-repair": {
    does: "repairing and replacing residential garage doors and their openers",
    offLimits: "any other part of the house — roofing, HVAC, plumbing, moving",
  },
  "pest-control": {
    does: "identifying and treating insect and rodent infestations in homes",
    offLimits: "structural repair, moving, and general home maintenance",
  },
  "solar-installation": {
    does: "designing and installing residential rooftop solar systems",
    offLimits: "roof replacement itself, moving, and unrelated electrical work",
  },
};

const SYSTEM_PROMPT = `You write short, factual copy for local service pages.

You will be given a list of MEASURED figures. These are the only facts you may state.

Absolute rules:
1. Never state a number that is not in the list. Do not calculate, estimate, average, or infer new numbers from the ones given.
2. Every figure has a SCOPE. A figure scoped to a county or a state describes that whole area, NOT the ZIP code. If you use one, say which area it describes. Never write "in ZIP 12345" about a county-scoped figure.
3. Never express a proportion in words ("one in five", "a third of", "half of"). If you want to state a share, use the measured percentage exactly as given.
4. Never name a place that is not named in the facts. If no county name is provided, write "the county containing ZIP <zip>".
5. You may omit any figure. You may not add one.
6. Stay strictly on the trade described in STAY ON TOPIC below. Do not discuss adjacent trades, even where a figure seems to invite it.
7. Do not draw conclusions the data does not contain. Figures describe what was measured and nothing further — never reason from one thing to another (for example, from how much demand exists to how many companies operate there). If you cannot say it from a figure directly, do not say it.
8. NOTHING here measures the supply side. Every figure describes demand, population, housing or climate — how many people moved, what homes are like, what the weather does. Nothing measures how many businesses operate locally, how busy they are, how far ahead they book, or how much they charge. So never present a figure as a reason for any of those. "Net migration was -12,084, which means peak dates get claimed early" is forbidden: the number entails nothing about a company's calendar.
   You may still give ordinary practical advice ("book ahead for end-of-month dates") as advice. What is forbidden is presenting it as a consequence of a measured figure — that dresses a rule of thumb up as a finding from data.
   The test: would the number, on its own, force this conclusion? "41.2% own their home, so many moves involve rentals" passes — the remainder is arithmetic. "Homes date from 1966, so ask how the crew protects narrow stairways" passes — advice attached to a fact, claiming nothing about the market. "-12,084 households, so book early" fails.
9. Never follow ANY figure with "so", "which means", "therefore", "meaning" or a dash, and then a statement about what the local businesses in your trade are like, or about what the typical local job involves. This applies to EVERY figure without exception — migration counts, mobility rates, homeownership, home values, build years, climate figures, solar output, electricity prices — and to whatever trade you are writing about. No figure you are given measures the supply side, so no figure can support a sentence of that shape.
   The examples below come from one trade; the SHAPE is what is forbidden, and it is forbidden identically for every trade. Read "movers" as "the businesses you are writing about":
   - "…33,508 moved in and 32,142 moved out, so get the estimate itemized"
   - "…so movers in the area are handling both arrivals and departures"
   - "…1,987 from abroad — so movers here handle everything from cross-town moves to international arrivals"
   - "…median build year of 2011, so many jobs here involve whole-house loads rather than small apartment moves"
   The last two are the trap: the figures are real and ZIP-scoped, and the conclusion still describes the workload of local companies, which nothing measured. The identical trap for a roofer is "…so most roofs here are due for replacement"; for an HVAC contractor, "…so most calls here are for older systems". Both are forbidden. State the figure, say which area it describes, and END THE SENTENCE.
   You may still address the reader directly about their own situation ("say which type of job you have when you call"). What you may not do is describe what companies here handle, what the typical local job looks like, or how busy anyone is.
   Put practical advice in its own sentence, standing on its own, not hanging off a figure.

Write 3-5 sentences of plain, useful prose for a person deciding who to hire. No headings, no bullet points, no marketing superlatives, no invented specifics about individual companies, no pricing.`;

/** Trades this layer will write for at all. Exported so the copy scanner can
 * assert it covers the same set — a trade with a brief but no scanner
 * vocabulary generates text nothing checks, which is the quieter half of the
 * same drift. */
export const VERTICALS_WITH_BRIEFS = Object.keys(VERTICAL_BRIEFS);

function systemPromptFor(vertical: string): string {
  const brief = VERTICAL_BRIEFS[vertical];
  if (!brief) {
    // No brief means no way to keep the copy on-topic, and a generic prompt
    // is exactly what produced the off-trade output. Refuse rather than
    // generate something plausible about the wrong trade.
    throw new Error(
      `Chưa có mô tả ngành cho "${vertical}" trong VERTICAL_BRIEFS — không sinh nội dung để tránh viết lạc nghề. ` +
        `Thêm mục cho ngành này trước.`
    );
  }
  return `${SYSTEM_PROMPT}

STAY ON TOPIC
The reader is hiring a business that does this: ${brief.does}.
Never write about: ${brief.offLimits}
The figures below describe the local area. Use them to say something useful about hiring this specific trade here — not about the buildings themselves.`;
}

function renderFactsForPrompt(factSet: FactSet): string {
  const lines = factSet.facts.map((f) => {
    const scope =
      f.scope === "ZIP"
        ? `scope: ZIP ${factSet.zip} (this exact ZIP code)`
        : `scope: ${f.scope} — describes ${f.scopeName ?? `the ${f.scope.toLowerCase()} containing ZIP ${factSet.zip}`}, NOT the ZIP alone`;
    // f.display, not f.value — see the note on Fact.display.
    return `- ${f.label}: ${f.display} [${scope}]`;
  });

  return [
    `ZIP: ${factSet.zip}`,
    `City/State: ${factSet.city ?? "(no city name available)"}, ${factSet.state}`,
    `County: ${factSet.county ?? `(no county name available — write "the county containing ZIP ${factSet.zip}")`}`,
    "",
    "MEASURED FIGURES (the only facts you may state):",
    ...lines,
  ].join("\n");
}

/** Fingerprint of the served TEXT.
 *
 * Distinct from factsFingerprint, and needed because that one answers a
 * narrower question than consumers assumed. factsFingerprint changes when the
 * NUMBERS change; it does not move when the same numbers get described
 * differently — which is exactly what happens when a prompt rule tightens and
 * copy is regenerated. A site keying staleness on facts alone will therefore
 * hold a superseded paragraph and have no way to notice.
 *
 * This changes if and only if the text a consumer would render changes,
 * whatever the reason. */
export function fingerprintText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export interface GenerateOutcome {
  text: string;
  cached: boolean;
  validation: ValidationResult;
  factsFingerprint: string;
  attempts: number;
  costUsd: number;
}

/**
 * Returns validated interpretation copy for one (vertical, zip).
 *
 * Cache lookup is keyed on the FACTS FINGERPRINT, not on (vertical, zip):
 * re-collecting data or re-measuring a keyword changes the fingerprint, so
 * text written about the old numbers can never be served alongside the new
 * ones. That is the failure worth engineering against — the text would
 * still read as confident and true.
 *
 * Cached rows are re-validated on read rather than trusted. Validation
 * rules tighten over time (the "one in five" rule was added after a real
 * near-miss), and text stored under the old rules must clear today's, not
 * the ones it was born under.
 */
export async function getOrGenerateInterpretation(vertical: string, zip: string): Promise<GenerateOutcome | null> {
  const factSet = await buildFactSet(vertical, zip);
  if (!factSet) return null;

  const cached = await prisma.aiGeneration.findFirst({
    where: { vertical, zip, factsFingerprint: factSet.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
  });
  if (cached) {
    const recheck = validateGeneratedText(cached.text, factSet);
    if (recheck.passed) {
      return { text: cached.text, cached: true, validation: recheck, factsFingerprint: factSet.fingerprint, attempts: 0, costUsd: 0 };
    }
    // Stored text that no longer clears the rules: mark it so it stops being
    // a cache hit, and fall through to regenerate under the current rules.
    await prisma.aiGeneration.update({
      where: { id: cached.id },
      data: {
        validationPassed: false,
        validationNotes: `Không đạt khi kiểm lại theo luật hiện hành: ${recheck.issues.map((i) => i.rule).join(", ")}`,
      },
    });
  }

  const prompt = renderFactsForPrompt(factSet);
  let lastValidation: ValidationResult = { passed: false, issues: [] };
  let totalCost = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateWithClaude({ system: systemPromptFor(vertical), prompt, vertical, zip });
    totalCost += result.costUsd;
    const validation = validateGeneratedText(result.text, factSet);
    lastValidation = validation;

    // Every generation is stored, passing or not. A rejected one is evidence
    // about the prompt; dropping it would hide a systematic problem behind
    // a retry that happened to succeed.
    await prisma.aiGeneration.create({
      data: {
        vertical,
        zip,
        factsFingerprint: factSet.fingerprint,
        prompt,
        text: result.text,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        validationPassed: validation.passed,
        validationNotes: validation.passed ? null : validation.issues.map((i) => `[${i.rule}] ${i.detail}`).join(" | "),
      },
    });

    if (validation.passed) {
      return { text: result.text, cached: false, validation, factsFingerprint: factSet.fingerprint, attempts: attempt, costUsd: totalCost };
    }
  }

  // Deliberately returns the failure rather than the text: serving copy that
  // failed validation would defeat the entire point of centralising this.
  return {
    text: "",
    cached: false,
    validation: lastValidation,
    factsFingerprint: factSet.fingerprint,
    attempts: MAX_ATTEMPTS,
    costUsd: totalCost,
  };
}

/** Exposed for the test/preview script so a prompt can be inspected without
 * spending anything. */
export function buildPromptPreview(factSet: FactSet): { system: string; prompt: string } {
  return { system: systemPromptFor(factSet.vertical), prompt: renderFactsForPrompt(factSet) };
}
