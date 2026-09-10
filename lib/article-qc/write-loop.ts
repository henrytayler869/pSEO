import { prisma } from "@/lib/db/prisma";
import { generateWithClaude } from "@/lib/ai/anthropic";
import { runQc, rewriteInstructions, type ArticleDraft, type QcContext, type QcReport } from "./checklist";
import { buildContentRules } from "@/lib/content-rules/registry";
import { fetchSitemapCounts } from "@/lib/sitemap/count";
import type { ArticleCandidate } from "@/lib/article-candidates/discover";
import type { FactSet } from "@/lib/ai/facts";

/**
 * Generate, check, rewrite, until every check passes or the budget runs out.
 *
 * The loop exists because a single pass is not verifiable: a draft that misses
 * two checks is not a bad article, it is an article nobody told what was
 * missing. What makes it safe rather than expensive is that the checklist can
 * fail — every item is mutation-proved in scripts/test-article-qc.ts — so
 * "passed" means something specific rather than "the model returned text".
 */

/**
 * Hard stop on rewrites.
 *
 * Three, not "until it passes". A loop with no ceiling spends real money on a
 * model that may be failing a check it cannot satisfy — a metric with no
 * semantic keyword to reach, say — and the failure mode is a bill rather than
 * an error. Three attempts is enough for the model to act on feedback twice;
 * past that the pattern in practice is the same check failing in the same way,
 * and a human should read it.
 */
const MAX_ATTEMPTS = 3;

const SYSTEM = `You write short editorial articles for a local-services website, from federal data.

HARD RULES — a violation means the whole draft is rejected:
1. Every number you write MUST appear in the FACTS list, written exactly as its "display" string shows it. You may drop decimal places; you may never add a digit, change a digit, or invent a figure.
2. Never state or imply anything about what service companies charge, how busy they are, what equipment they use, or what a typical job involves. No dataset here measures suppliers. You may address the READER directly — what to ask, what to confirm, what to compare — and that is the correct way to be useful commercially.
3. A figure measured at county or state level must say so in the same sentence that contains it.
4. Do not mention keywords, search volume, SEO, or ranking.

Output STRICT JSON, no prose around it:
{"title": "...", "metaDescription": "...", "html": "<p>...</p>"}

html: plain semantic HTML — p, h2, ul, li, a. No inline styles, no classes.`;

function factsBlock(facts: FactSet["facts"]): string {
  return facts
    .map((f) => `- ${f.label} | display: "${f.display}" | measured at: ${f.scope}${f.scopeName ? ` (${f.scopeName})` : ""}`)
    .join("\n");
}

function buildPrompt(
  candidate: ArticleCandidate,
  ctx: QcContext,
  previous: { draft: ArticleDraft; report: QcReport } | null
): string {
  const base = `TOPIC: ${candidate.title}
WHY IT IS WORTH WRITING: ${candidate.why}
READER INTENT: ${candidate.intent}
SCOPE: ${candidate.scope.kind} — ${candidate.scope.name}

FACTS — the only numbers you may use:
${factsBlock(ctx.factSet.facts)}

SEMANTIC TERMS to work in naturally (at least two): ${ctx.semanticKeywords.join(", ")}

INTERNAL LINKS — link to at least one, using these exact paths:
${[...ctx.knownPaths].slice(0, 12).join("\n")}

RESERVED TERMS — if you use one as link text, it MUST link to its own page:
${ctx.reservedTerms.map((r) => `"${r.term}" -> ${r.ownedBy}`).join("\n") || "(none)"}

Length: at least 400 words. At least two <h2> sections. Title 30-65 characters. metaDescription 70-160 characters.`;

  if (!previous) return base;

  // The previous draft goes back verbatim alongside the failures. Asking for a
  // fresh article instead loses the parts that already passed, and the next
  // draft then breaks something different — the loop stops converging and
  // starts circling.
  return `${base}

Your previous draft FAILED these checks. Fix exactly these and change nothing else:

${rewriteInstructions(previous.report)}

PREVIOUS DRAFT:
${JSON.stringify(previous.draft)}`;
}

function parseDraft(text: string): ArticleDraft {
  // The model is asked for bare JSON but may wrap it in a fence. Stripping is
  // cheaper than a retry, and a retry here would be charged as a QC failure it
  // is not.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<ArticleDraft>;
  if (typeof parsed.title !== "string" || typeof parsed.html !== "string") {
    throw new Error("Model không trả về JSON có title và html.");
  }
  return {
    title: parsed.title,
    metaDescription: typeof parsed.metaDescription === "string" ? parsed.metaDescription : "",
    html: parsed.html,
  };
}

/**
 * Everything the checklist needs, gathered once per site rather than per
 * article — the sitemap fetch and the contract read do not change between
 * candidates in one batch, and doing them per article would turn a 20-article
 * run into 20 extra HTTP calls to the publisher.
 */
export async function buildQcContext(
  websiteId: string,
  vertical: string,
  siteUrl: string
): Promise<Omit<QcContext, "factSet">> {
  const [rules, keywords, existing, sitemap] = await Promise.all([
    buildContentRules(),
    prisma.semanticKeyword.findMany({ where: { vertical }, orderBy: { searchVolume: "desc" }, select: { keyword: true } }),
    prisma.article.findMany({ where: { websiteId }, select: { title: true } }),
    fetchSitemapCounts(siteUrl),
  ]);

  const knownPaths = new Set<string>();
  for (const url of sitemap.urls) {
    try {
      knownPaths.add(new URL(url).pathname.replace(/\/+$/, "") || "/");
    } catch {
      // A malformed entry in someone else's sitemap is not this loop's
      // problem, and dropping it is better than failing every article.
    }
  }

  return {
    semanticKeywords: keywords.map((k) => k.keyword),
    reservedTerms: rules.reservedTerms,
    knownPaths,
    existingTitles: existing.map((a) => a.title),
  };
}

export interface WriteResult {
  draft: ArticleDraft;
  report: QcReport;
  attempts: number;
  costUsd: number;
}

export async function writeArticle(params: {
  candidate: ArticleCandidate;
  ctx: QcContext;
  websiteId: string;
  articleId: string;
}): Promise<WriteResult> {
  let previous: { draft: ArticleDraft; report: QcReport } | null = null;
  let costUsd = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await generateWithClaude({
      system: SYSTEM,
      prompt: buildPrompt(params.candidate, params.ctx, previous),
      vertical: params.candidate.vertical,
      zip: null,
      websiteId: params.websiteId,
      articleId: params.articleId,
    });
    // Added before parsing, not after: the call was billed whether or not the
    // response is usable, and a cost figure that only counts parseable
    // responses under-reports exactly when the model is misbehaving.
    costUsd += result.costUsd;

    let draft: ArticleDraft;
    try {
      draft = parseDraft(result.text);
    } catch (err) {
      previous = {
        draft: { title: "", metaDescription: "", html: result.text.slice(0, 2000) },
        report: {
          passed: false,
          checks: [
            {
              id: "parse",
              label: "Trả về JSON hợp lệ",
              passed: false,
              detail: err instanceof Error ? err.message : "Không đọc được JSON.",
            },
          ],
        },
      };
      continue;
    }

    const report = runQc(draft, params.ctx);
    if (report.passed) return { draft, report, attempts: attempt, costUsd };
    previous = { draft, report };
  }

  // Returned rather than thrown. A draft that failed after three tries is
  // still the most useful thing in the room: it carries the report saying
  // which check it could not satisfy, which is what a person needs in order
  // to decide whether the article or the check is wrong.
  return {
    draft: previous!.draft,
    report: previous!.report,
    attempts: MAX_ATTEMPTS,
    costUsd,
  };
}
