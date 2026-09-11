import { assertTemplate, placeholders, type ArticleTemplateShape, type Block } from "./render";
import type { ArticleCandidate } from "@/lib/article-candidates/discover";

/**
 * What a person may save as a template.
 *
 * A template used to be code, reviewed in a pull request. It is now a row a
 * person edits in a text field, so the review has to move into the code that
 * accepts it.
 *
 * The check that matters most is the `cta` block: it is the ONE place template
 * text reaches the page without escaping, and `runQc` strips tags before it
 * looks at anything — so a script tag there would appear on every article the
 * template builds and no check on the page would see it. Not a hypothetical
 * attacker; a paste from a chat widget's install snippet does it by accident.
 */

/** Tags a CTA may contain. Anything that can execute or embed is absent on
 * purpose, not overlooked. */
const CTA_ALLOWED_TAGS = new Set(["p", "a", "strong", "em", "br", "ul", "ol", "li", "h3", "span", "div", "small"]);

export interface TemplateProblem {
  where: string;
  message: string;
}

/** Every placeholder key a pattern may use, taken from the renderer rather
 * than typed again — a second list would drift and start rejecting keys that
 * work. */
export function knownPlaceholderKeys(): string[] {
  const fake: ArticleCandidate = {
    id: "x",
    websiteId: "x",
    vertical: "x",
    intent: "x",
    angle: "x",
    title: "x",
    why: "x",
    scope: { kind: "COUNTY", name: "x" },
    facts: [],
  } as unknown as ArticleCandidate;
  return Object.keys(placeholders(fake));
}

function unknownKeysIn(pattern: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (const m of pattern.matchAll(/\{(\w+)\}/g)) {
    if (!known.has(m[1])) out.push(m[1]);
  }
  return out;
}

function checkCtaHtml(html: string): string | null {
  if (/<\s*(script|iframe|object|embed|form|style|link|meta)\b/i.test(html)) {
    return "Chứa thẻ có thể chạy hoặc nhúng (script/iframe/form/...). Khối CTA là chỗ duy nhất không được escape, và không phép kiểm nào trên trang nhìn thấy nó.";
  }
  if (/\son\w+\s*=/i.test(html)) return "Chứa thuộc tính sự kiện (onclick, onload, ...).";
  if (/javascript\s*:/i.test(html)) return "Chứa javascript: trong đường dẫn.";
  const tags = [...html.matchAll(/<\s*\/?\s*([a-zA-Z][\w-]*)/g)].map((m) => m[1].toLowerCase());
  const bad = [...new Set(tags)].filter((t) => !CTA_ALLOWED_TAGS.has(t));
  if (bad.length > 0) return `Thẻ không nằm trong danh sách cho phép: ${bad.join(", ")}.`;
  return null;
}

function describe(b: Block, i: number): string {
  return `Khối ${i + 1} (${b.type})`;
}

/**
 * Every reason this template may not be saved. Empty array means saveable.
 *
 * Returns ALL problems rather than the first: fixing one at a time through a
 * form that only ever shows one error is how a person gives up and pastes the
 * default back.
 */
export function validateTemplate(t: ArticleTemplateShape): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const known = new Set(knownPlaceholderKeys());

  const structural = assertTemplate(t);
  if (structural) problems.push({ where: "Cấu trúc", message: structural });

  if (!t.titlePattern.trim()) problems.push({ where: "Tiêu đề", message: "Không được để trống." });
  if (!t.metaPattern.trim()) problems.push({ where: "Meta description", message: "Không được để trống." });

  for (const [label, pattern] of [["Tiêu đề", t.titlePattern], ["Meta description", t.metaPattern]] as const) {
    const bad = unknownKeysIn(pattern, known);
    if (bad.length > 0) {
      problems.push({
        where: label,
        message: `Biến không tồn tại: ${bad.map((k) => `{${k}}`).join(", ")}. Nó sẽ hiện nguyên văn trên mọi bài. Biến dùng được: ${[...known].map((k) => `{${k}}`).join(", ")}.`,
      });
    }
  }

  t.blocks.forEach((b, i) => {
    const texts: string[] = [];
    if (b.type === "heading") texts.push(b.text);
    if (b.type === "paragraph") texts.push(b.text);
    if (b.type === "data-table" && b.caption) texts.push(b.caption);
    for (const text of texts) {
      if (!text.trim()) problems.push({ where: describe(b, i), message: "Không được để trống." });
      const bad = unknownKeysIn(text, known);
      if (bad.length > 0) {
        problems.push({ where: describe(b, i), message: `Biến không tồn tại: ${bad.map((k) => `{${k}}`).join(", ")}.` });
      }
    }
    if (b.type === "cta") {
      const err = checkCtaHtml(b.html);
      if (err) problems.push({ where: describe(b, i), message: err });
    }
    if (b.type === "internal-links") {
      const bad = b.paths.filter((p) => !p.startsWith("/"));
      if (bad.length > 0) {
        problems.push({
          where: describe(b, i),
          message: `Đường dẫn phải bắt đầu bằng "/": ${bad.join(", ")}. Link ngoài không thuộc khối link nội bộ.`,
        });
      }
    }
  });

  return problems;
}
