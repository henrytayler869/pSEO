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
  // KHÔNG có {topValue}/{bottomValue} nữa.
  //
  // Bản trước lấy fact có value lớn nhất, đúng khi các fact là cùng một chỉ số
  // ở nhiều nơi. Giờ chúng là nhiều chỉ số của một nơi, nên "lớn nhất" là so
  // $588,500 với 42.6% — một con số vô nghĩa mà template vẫn in ra được, và
  // không phép kiểm nào bắt được vì nó là số thật lấy từ fact thật.
  //
  // Thay bằng {leadName}/{leadValue}: fact ĐẦU TIÊN sau khi sắp theo intent,
  // tức một chỉ số cụ thể, so với chính nó thì mới có nghĩa.
  const lead = c.facts[0];
  return {
    city: c.city,
    state: c.state,
    zip: c.zip,
    county: c.county ?? `the county containing ZIP ${c.zip}`,
    scopeName: c.scope.name,
    count: String(c.facts.length),
    leadName: lead?.label ?? "",
    leadValue: lead ? formatForPrompt(lead.value, lead.unit) : "",
    measuredAt: lead?.scope ?? "",
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

/**
 * Chỉ phần VĂN XUÔI của template, đã thay biến.
 *
 * Dùng để so với đoạn model viết. Cố ý BỎ bảng số liệu, ghi chú nguồn và khối
 * link: nhãn chỉ số nằm trong bảng ("people who moved in from another state
 * last year" — 9 chữ), và model BẮT BUỘC phải gọi tên được các con số nó đang
 * nói tới. Đưa bảng vào phép so sẽ phạt nó vì làm đúng việc.
 *
 * Thứ đáng bắt là model nói lại LỜI KHUYÊN hay CÂU DẪN mà template đã nói —
 * và những câu đó chỉ nằm trong heading, paragraph và cta.
 */
export function templateProse(t: ArticleTemplateShape, vars: Record<string, string>): string {
  const parts: string[] = [];
  for (const b of t.blocks) {
    if (b.type === "heading" || b.type === "paragraph") parts.push(fill(b.text, vars));
    else if (b.type === "cta") {
      if (b.heading) parts.push(b.heading);
      parts.push(b.html.replace(/<[^>]+>/g, " "));
    }
  }
  return parts.join(" ");
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
        // KHÔNG sắp theo giá trị.
        //
        // Bản trước sort giảm dần theo value, đúng khi mọi hàng là cùng một
        // chỉ số ở nhiều nơi. Giờ mỗi hàng là một chỉ số khác nhau của cùng
        // một nơi, nên sắp theo value là xếp $1.22 tỷ, 12,438 hộ, 1955 (một
        // năm) và 12.9% vào cùng một thang. Giữ nguyên thứ tự fact, tức thứ
        // tự theo intent: chỉ số phục vụ việc người đọc đang làm lên trước.
        //
        // Cột thứ ba là VÙNG ĐO. Bốn trong mười ba chỉ số ở đây đo cấp county;
        // in chúng cạnh số liệu ZIP mà không nói gì là biến một con số county
        // thành một khẳng định về ZIP — đúng lỗi scope_overclaim mà lớp trang
        // market đã phải chặn ở prompt.
        const rows = params.candidate.facts
          .map(
            (f) =>
              `<tr><td>${esc(f.label)}</td><td>${esc(f.display)}</td><td>${esc(
                f.scope === "ZIP"
                  ? `ZIP ${params.candidate.zip}`
                  : f.scopeName ?? (f.scope === "COUNTY" ? "county" : "state")
              )}</td></tr>`
          )
          .join("");
        parts.push(
          `<table>${b.caption ? `<caption>${esc(fill(b.caption, vars))}</caption>` : ""}` +
            `<thead><tr><th>Figure</th><th>Value</th><th>Area measured</th></tr></thead>` +
            `<tbody>${rows}</tbody></table>`
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
      case "source-note": {
        // Không tuyên bố MỘT cấp đo cho cả trang. Trang này trộn chỉ số ZIP và
        // chỉ số county, nên một câu "measured at ZIP level" sẽ sai với bốn
        // hàng — và sai theo hướng phóng đại độ cụ thể, hướng nguy hiểm hơn.
        const levels = [...new Set(params.candidate.facts.map((f) => f.scope))];
        parts.push(
          `<p><em>Source: ${esc(params.sourceNames.join(", "))}. ` +
            `Each figure is labelled with the area it was measured for` +
            (levels.length > 1 ? ` — this page mixes ${esc(levels.join(" and "))}-level figures.` : `.`) +
            `</em></p>`
        );
        break;
      }
    }
  }

  return {
    title: fill(params.template.titlePattern, vars),
    metaDescription: fill(params.template.metaPattern, vars),
    html: parts.join("\n"),
  };
}
