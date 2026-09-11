import { formatForPrompt } from "@/lib/ai/facts";
import type { ArticleCandidate } from "@/lib/article-candidates/discover";

/**
 * Assembles an article from a publisher's template, the dataset, and ONE
 * AI-written paragraph.
 *
 * The ratio is the design, not an economy measure. The market pages this
 * mirrors are 90% template and 10% model — measured 2026-09-11: 1,061 of
 * 10,674 characters. Almost nothing on the page came from a model, so almost
 * nothing on it can be invented, and the numeric contract holds by
 * construction rather than by checking afterwards.
 *
 * An earlier version of this feature had the model write the whole article. It
 * would have passed the same validator — but "passes a check" and "cannot be
 * wrong" are different guarantees, and only the second one survives a prompt
 * change nobody reviewed.
 */

export type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  /** The ranked rows, rendered from the candidate's facts. No prose, so no
   * opportunity to describe them wrongly. */
  | { type: "data-table"; caption?: string }
  /** THE model block. Exactly one per template — see assertTemplate. */
  | { type: "ai-interpretation" }
  /** Links, filtered to paths the site actually serves. */
  | { type: "internal-links"; heading?: string; paths: string[] }
  | { type: "cta"; heading?: string; html: string }
  | { type: "source-note" };

export interface ArticleTemplateShape {
  titlePattern: string;
  metaPattern: string;
  blocks: Block[];
}

/**
 * Placeholders a template may use. Every one resolves from the candidate, so a
 * template cannot introduce a value the dataset did not measure.
 *
 * An unknown placeholder is left VERBATIM rather than blanked: a template with
 * a typo then shows `{scopename}` in the draft, which someone will notice,
 * instead of a gap nobody can attribute.
 */
export function placeholders(c: ArticleCandidate): Record<string, string> {
  const sorted = [...c.facts].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  return {
    scopeName: c.scope.name,
    scopeKind: c.scope.kind === "COUNTY" ? "county" : "state",
    count: String(c.facts.length),
    topName: top?.label.split("—").pop()?.trim() ?? "",
    topValue: top ? formatForPrompt(top.value, top.unit) : "",
    bottomName: bottom?.label.split("—").pop()?.trim() ?? "",
    bottomValue: bottom ? formatForPrompt(bottom.value, bottom.unit) : "",
    measuredAt: top?.scope ?? "",
  };
}

export function fill(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A template must contain EXACTLY ONE ai-interpretation block.
 *
 * Zero means every article on the site is identical apart from its numbers —
 * the near-duplicate shape the differentiation gate exists to stop. Two or more
 * means two model paragraphs per article, which doubles both the cost and the
 * surface a fabricated number can appear on, silently.
 *
 * Checked rather than trusted because a template is DATA now: it is edited in
 * Settings by a person, not reviewed in a pull request.
 */
export function assertTemplate(t: ArticleTemplateShape): string | null {
  const n = t.blocks.filter((b) => b.type === "ai-interpretation").length;
  if (n !== 1) return `Template phải có ĐÚNG MỘT khối ai-interpretation, hiện có ${n}.`;
  if (!t.blocks.some((b) => b.type === "data-table")) return "Template phải có khối data-table — đó là chỗ số liệu xuất hiện.";
  if (!t.blocks.some((b) => b.type === "source-note")) return "Template phải có khối source-note — mọi con số phải nói nguồn.";
  return null;
}

export function renderArticle(params: {
  template: ArticleTemplateShape;
  candidate: ArticleCandidate;
  aiParagraph: string;
  knownPaths: Set<string>;
  sourceNames: string[];
}): { title: string; metaDescription: string; html: string } {
  const vars = placeholders(params.candidate);
  const parts: string[] = [];

  for (const b of params.template.blocks) {
    switch (b.type) {
      case "heading":
        parts.push(`<h${b.level}>${esc(fill(b.text, vars))}</h${b.level}>`);
        break;
      case "paragraph":
        parts.push(`<p>${esc(fill(b.text, vars))}</p>`);
        break;
      case "data-table": {
        const rows = [...params.candidate.facts]
          .sort((a, b2) => b2.value - a.value)
          .map(
            (f) =>
              `<tr><td>${esc(f.label.split("—").pop()?.trim() ?? f.label)}</td><td>${esc(f.display)}</td></tr>`
          )
          .join("");
        parts.push(
          `<table>${b.caption ? `<caption>${esc(fill(b.caption, vars))}</caption>` : ""}<tbody>${rows}</tbody></table>`
        );
        break;
      }
      case "ai-interpretation":
        // Wrapped in <p> here rather than asking the model for HTML: a model
        // that returns markup can return markup nobody asked for, and the
        // template owns structure.
        parts.push(`<p>${esc(params.aiParagraph.trim())}</p>`);
        break;
      case "internal-links": {
        // Filtered against the live sitemap. A template naming a path the site
        // stopped serving would otherwise emit a 404 on every article built
        // from it — the publisher already shipped 10 such links, written by
        // code rather than by a model.
        const live = b.paths.filter((p) => params.knownPaths.has(p.replace(/\/+$/, "") || "/"));
        if (live.length === 0) break;
        parts.push(
          `${b.heading ? `<h2>${esc(b.heading)}</h2>` : ""}<ul>${live
            .map((p) => `<li><a href="${esc(p)}">${esc(p.replace(/^\//, "").replace(/-/g, " ") || "home")}</a></li>`)
            .join("")}</ul>`
        );
        break;
      }
      case "cta":
        parts.push(`${b.heading ? `<h2>${esc(b.heading)}</h2>` : ""}${b.html}`);
        break;
      case "source-note":
        parts.push(
          `<p><em>Source: ${esc(params.sourceNames.join(", "))}. Figures are measured at ${esc(vars.measuredAt)} level.</em></p>`
        );
        break;
    }
  }

  return {
    title: fill(params.template.titlePattern, vars),
    metaDescription: fill(params.template.metaPattern, vars),
    html: parts.join("\n"),
  };
}
