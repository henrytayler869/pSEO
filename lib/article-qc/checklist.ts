import { validateGeneratedText } from "@/lib/ai/validate";
import { isSupplySideBridge } from "@/lib/content-rules/rendered-rules";
import type { Fact, FactSet } from "@/lib/ai/facts";

/**
 * The gate an article must pass before it becomes a WordPress draft.
 *
 * Every check here can FAIL. That sounds obvious and is the thing this project
 * keeps finding is not true: a checklist item that cannot fire reads exactly
 * like one that is guarding something, and it is worse than absent because it
 * consumes the attention a real check would have got. Each check below is
 * proved by mutation in scripts/test-article-qc.ts — the assertion is not
 * "the check passes on a good article" but "the check fails on a bad one".
 *
 * The checks are deliberately mechanical. Nothing here judges whether an
 * article is INTERESTING; that judgement belongs to the person reading the
 * draft, and a machine pretending to make it would produce a number nobody
 * should trust.
 */

export interface QcContext {
  /** The only numbers the article may contain. */
  factSet: FactSet;
  /** Semantic keywords for the trade, from SemanticKeyword. */
  semanticKeywords: string[];
  /** term -> the pillar page that owns it. A reserved term may be used, but an
   * anchor carrying it must link to its owner. */
  reservedTerms: { term: string; ownedBy: string }[];
  /** Paths the publisher actually serves, read from its sitemap. An internal
   * link is only "internal" if it lands somewhere. */
  knownPaths: Set<string>;
  /** Titles already used on this site, to catch a second article about the
   * same thing. */
  existingTitles: string[];
}

export interface QcCheck {
  id: string;
  label: string;
  passed: boolean;
  /** Says what went wrong AND what to change — this text is fed back into the
   * rewrite prompt, so "title too long" without the limit produces a second
   * draft that is also too long. */
  detail: string;
}

export interface QcReport {
  passed: boolean;
  checks: QcCheck[];
}

export interface ArticleDraft {
  title: string;
  metaDescription: string;
  /** HTML as it will be stored in WordPress. */
  html: string;
}

/** Visible text, with tags removed. Every prose check runs on this rather than
 * on HTML — otherwise an attribute value counts as a sentence and a class name
 * counts as a keyword. */
function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function anchors(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ href: m[1], text: textOf(m[2]) });
  }
  return out;
}

/** Title bounds. 30 because a shorter one is not describing an article; 65
 * because Google truncates around there and a truncated title loses the end,
 * which is where the specific part usually is. */
const TITLE_MIN = 30;
const TITLE_MAX = 65;
const META_MIN = 70;
const META_MAX = 160;
const MIN_WORDS = 350;
const MIN_H2 = 2;
const MIN_SEMANTIC = 2;

export function runQc(draft: ArticleDraft, ctx: QcContext): QcReport {
  const text = textOf(draft.html);
  const words = text.split(/\s+/).filter(Boolean).length;
  const checks: QcCheck[] = [];

  // 1. Numbers. Reuses the validator that guards market pages, unchanged — an
  //    article is held to the same numeric contract as everything else.
  const v = validateGeneratedText(text, ctx.factSet);
  checks.push({
    id: "facts-verified",
    label: "Mọi con số đến từ dataset",
    passed: v.passed,
    detail: v.passed
      ? `${ctx.factSet.facts.length} fact, không con số nào ngoài danh sách.`
      : v.issues.map((i) => `[${i.rule}] ${i.detail}`).join(" | "),
  });

  // 2. Supply-side. The dataset measures who moves, never what movers charge
  //    or how busy they are, so a figure must not carry a claim about them.
  const bridged = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => isSupplySideBridge(s));
  checks.push({
    id: "no-supply-side-claim",
    label: "Không treo nhận định về nhà cung cấp lên số liệu",
    passed: bridged.length === 0,
    detail:
      bridged.length === 0
        ? "Không câu nào nối một đại lượng đo với khẳng định về công ty."
        : `${bridged.length} câu vi phạm. Sửa bằng cách hướng NGƯỜI ĐỌC (hỏi gì, xác nhận gì) thay vì khẳng định về hãng: ${bridged[0].slice(0, 120)}`,
  });

  // 3. Semantic coverage.
  const hit = ctx.semanticKeywords.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
  checks.push({
    id: "semantic-coverage",
    label: `Có ít nhất ${MIN_SEMANTIC} từ khoá ngữ nghĩa`,
    passed: hit.length >= MIN_SEMANTIC,
    detail:
      hit.length >= MIN_SEMANTIC
        ? `Dùng ${hit.length}: ${hit.join(", ")}`
        : `Mới có ${hit.length}/${MIN_SEMANTIC}. Có thể dùng: ${ctx.semanticKeywords.filter((k) => !hit.includes(k)).join(", ")}`,
  });

  // 4. Internal links, checked against paths the site ACTUALLY serves.
  //
  //    A link is not internal because it starts with "/" — it is internal
  //    because it lands. The publisher shipped 10 links to 404 for exactly
  //    this reason, and those were written by code, not by a model.
  const internal = anchors(draft.html).filter((a) => a.href.startsWith("/"));
  const dead = internal.filter((a) => !ctx.knownPaths.has(a.href.replace(/\/+$/, "") || "/"));
  checks.push({
    id: "internal-links",
    label: "Có link nội bộ, và mọi link đều tới trang có thật",
    passed: internal.length >= 1 && dead.length === 0,
    detail:
      internal.length === 0
        ? `Chưa có link nội bộ nào. Các trang có thật để trỏ tới: ${[...ctx.knownPaths].slice(0, 8).join(", ")}`
        : dead.length > 0
          ? `${dead.length} link trỏ vào trang KHÔNG tồn tại: ${dead.map((d) => d.href).join(", ")}`
          : `${internal.length} link nội bộ, tất cả đều tới trang có thật.`,
  });

  // 5. Reserved terms. Using one is fine; using it as an anchor to somewhere
  //    other than its owner competes with the pillar page for its own term.
  const misdirected = ctx.reservedTerms.flatMap((rt) =>
    anchors(draft.html)
      .filter((a) => a.text.toLowerCase().includes(rt.term.toLowerCase()) && !a.href.includes(rt.ownedBy))
      .map((a) => `"${rt.term}" -> ${a.href} (phải là ${rt.ownedBy})`)
  );
  checks.push({
    id: "reserved-term-anchors",
    label: "Term dành riêng chỉ neo về trang pillar của nó",
    passed: misdirected.length === 0,
    detail: misdirected.length === 0 ? "Không anchor nào lấn term của pillar." : misdirected.join(" | "),
  });

  // 6-8. Shape. Mechanical, and each one is a thing Technical SEO measured as
  //      a real defect on the live site rather than a rule from a checklist
  //      someone copied.
  checks.push({
    id: "title-length",
    label: `Tiêu đề ${TITLE_MIN}-${TITLE_MAX} ký tự`,
    passed: draft.title.length >= TITLE_MIN && draft.title.length <= TITLE_MAX,
    detail: `Hiện ${draft.title.length} ký tự.`,
  });
  checks.push({
    id: "meta-description",
    label: `Meta description ${META_MIN}-${META_MAX} ký tự`,
    passed: draft.metaDescription.length >= META_MIN && draft.metaDescription.length <= META_MAX,
    detail: draft.metaDescription
      ? `Hiện ${draft.metaDescription.length} ký tự.`
      : "Chưa có meta description.",
  });
  checks.push({
    id: "min-words",
    label: `Ít nhất ${MIN_WORDS} từ`,
    passed: words >= MIN_WORDS,
    detail: `Hiện ${words} từ.`,
  });
  const h2 = (draft.html.match(/<h2\b/gi) ?? []).length;
  checks.push({
    id: "heading-structure",
    label: `Ít nhất ${MIN_H2} thẻ H2`,
    passed: h2 >= MIN_H2,
    detail: `Hiện ${h2} thẻ H2.`,
  });

  // 9. Not a second article about the same thing. Compared against titles
  //    already on this site, because the duplication that costs is
  //    duplication within one domain.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const clash = ctx.existingTitles.find((t) => norm(t) === norm(draft.title));
  checks.push({
    id: "not-duplicate-title",
    label: "Tiêu đề chưa từng dùng trên site này",
    passed: !clash,
    detail: clash ? `Trùng với bài đã có: "${clash}"` : "Tiêu đề chưa xuất hiện.",
  });

  return { passed: checks.every((c) => c.passed), checks };
}

/** The failures, phrased as instructions, for the rewrite attempt. Only the
 * failed ones: handing the model a list where most lines say "đạt" buries the
 * two that do not. */
export function rewriteInstructions(report: QcReport): string {
  return report.checks
    .filter((c) => !c.passed)
    .map((c) => `- ${c.label}: ${c.detail}`)
    .join("\n");
}

export type { Fact };
