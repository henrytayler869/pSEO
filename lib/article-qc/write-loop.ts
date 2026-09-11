import { prisma } from "@/lib/db/prisma";
import { generateWithClaude } from "@/lib/ai/anthropic";
import { runQc, rewriteInstructions, type ArticleDraft, type QcContext, type QcReport } from "./checklist";
import { buildContentRules } from "@/lib/content-rules/registry";
import { fetchSitemapCounts } from "@/lib/sitemap/count";
import type { ArticleCandidate } from "@/lib/article-candidates/discover";
import type { FactSet } from "@/lib/ai/facts";
import { renderArticle, assertTemplate, type ArticleTemplateShape } from "@/lib/article-template/render";

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

const SYSTEM = `You write ONE short interpretation paragraph for a data page on a local-services website.

You are not writing the article. The page already has its title, its headings, its table of figures, its links and its source note — all assembled from a template. Your paragraph is the one part that differs between pages, and it exists so two pages about two places do not read identically.

HARD RULES — a violation means the whole draft is rejected:
1. Every number you write MUST appear in the FACTS list, written exactly as its "display" string shows it. You may drop decimal places; you may never add a digit, change a digit, or invent a figure.
2. Never state or imply anything about what service companies charge, how busy they are, what equipment they use, or what a typical job involves. No dataset here measures suppliers. You may address the READER directly — what to ask, what to confirm, what to compare.
3. A figure measured at county or state level must say so in the same sentence that contains it.
4. Do not mention keywords, search volume, SEO, or ranking.
5. Do not repeat the table. Say what the figures MEAN for someone reading them.

Output the paragraph as PLAIN TEXT. No HTML, no markdown, no quotes around it. Two to four sentences.`;

function factsBlock(facts: FactSet["facts"]): string {
  return facts
    .map((f) => `- ${f.label} | display: "${f.display}" | measured at: ${f.scope}${f.scopeName ? ` (${f.scopeName})` : ""}`)
    .join("\n");
}

function buildPrompt(
  candidate: ArticleCandidate,
  ctx: QcContext,
  previous: { paragraph: string; report: QcReport } | null
): string {
  const base = `TOPIC: ${candidate.title}
WHY IT IS WORTH WRITING: ${candidate.why}
READER INTENT: ${candidate.intent}
SCOPE: ${candidate.scope.kind} — ${candidate.scope.name}

FACTS — the only numbers you may use:
${factsBlock(ctx.factSet.facts)}

SEMANTIC TERMS you may work in if they fit naturally: ${ctx.semanticKeywords.join(", ")}`;

  if (!previous) return base;

  // The previous paragraph goes back verbatim alongside the failures. Asking
  // for a fresh one loses whatever already passed, and the next attempt then
  // breaks something different — the loop stops converging and starts
  // circling.
  //
  // The failures may concern parts of the page this paragraph does not
  // control — a title pattern, a missing link — and that is said plainly
  // below, because a model told to fix something it cannot reach will damage
  // something it can.
  return `${base}

The assembled page FAILED these checks:

${rewriteInstructions(previous.report)}

Your previous paragraph:
${previous.paragraph}

Rewrite the paragraph to fix any of the above that a PARAGRAPH can fix — wrong or invented numbers, claims about companies, a missing scope word, a semantic term that would fit. If a failure is about the title, the links, the headings or duplication, it comes from the template and you cannot fix it: leave your paragraph as close to the previous one as possible.`;
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
  /** The model's contribution, kept separate from the assembled page so a bad
   * article can be traced to the paragraph or to the template. */
  paragraph: string;
}

export async function writeArticle(params: {
  candidate: ArticleCandidate;
  ctx: QcContext;
  template: ArticleTemplateShape;
  sourceNames: string[];
  websiteId: string;
  articleId: string;
}): Promise<WriteResult> {
  // Checked before spending anything. A template missing its data-table or
  // carrying two model blocks produces a broken page on every attempt, and
  // finding that out after three billed calls is finding it out three calls
  // too late.
  const templateError = assertTemplate(params.template);
  if (templateError) {
    const report: QcReport = {
      passed: false,
      checks: [{ id: "template", label: "Template hợp lệ", passed: false, detail: templateError }],
    };
    return {
      draft: { title: "", metaDescription: "", html: "" },
      report,
      attempts: 0,
      costUsd: 0,
      paragraph: "",
    };
  }

  let previous: { paragraph: string; report: QcReport } | null = null;
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
    // Added before anything can throw: the call was billed whether or not the
    // text is usable, and a cost figure that only counts usable responses
    // under-reports exactly when the model is misbehaving.
    costUsd += result.costUsd;

    // Strip any markup the model added despite being told not to. The template
    // owns structure; a paragraph arriving with its own tags would put model
    // output into a position no check inspects.
    const paragraph = result.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const draft = renderArticle({
      template: params.template,
      candidate: params.candidate,
      aiParagraph: paragraph,
      knownPaths: params.ctx.knownPaths,
      sourceNames: params.sourceNames,
    });

    // QC runs on the ASSEMBLED page, not on the paragraph. The failure this
    // guards against is the one already measured on the live site: 368
    // violating sentences, none of them from a model, all of them in template
    // text that no content check ever looked at.
    const report = runQc(draft, params.ctx);
    if (report.passed) return { draft, report, attempts: attempt, costUsd, paragraph };
    previous = { paragraph, report };
  }

  const finalDraft = renderArticle({
    template: params.template,
    candidate: params.candidate,
    aiParagraph: previous!.paragraph,
    knownPaths: params.ctx.knownPaths,
    sourceNames: params.sourceNames,
  });
  return {
    draft: finalDraft,
    report: previous!.report,
    attempts: MAX_ATTEMPTS,
    costUsd,
    paragraph: previous!.paragraph,
  };
}
