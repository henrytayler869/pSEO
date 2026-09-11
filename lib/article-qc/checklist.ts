import { validateGeneratedText } from "@/lib/ai/validate";
import { isSupplySideBridge } from "@/lib/content-rules/rendered-rules";
import type { Fact, FactSet } from "@/lib/ai/facts";
import { compilePattern, type ActiveRules } from "./rules";

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
  /**
   * Which checks are on, and with what thresholds. Read from QcRule.
   *
   * A deactivated check is ABSENT from the report, not present-and-passing.
   * Rendering it as a green tick would say "we looked and it was fine" about
   * something nobody looked at — and a report where the off switch looks
   * identical to a pass is a report that cannot be read.
   */
  rules: ActiveRules;
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

/**
 * Bounds. Each one is a thing measured as a real defect on the live site
 * rather than a rule copied from a checklist.
 *
 * There is deliberately NO minimum word count. One existed (350) and was
 * removed 2026-09-11 on the project owner's call, after it turned out to
 * contradict the design it was meant to guard: the default templates produce
 * 107, 92 and 77 words, so every article built from them would have failed a
 * check written before the templates existed.
 *
 * Keeping it would have pushed the fix in the wrong direction — padding every
 * template with filler prose that repeats on every article, to satisfy a
 * number nobody chose. Length is not the property that matters here; whether
 * every figure is real, sourced and correctly scoped is, and those have their
 * own checks.
 *
 * Title: 30 because a shorter one is not describing an article; 65 because
 * Google truncates around there and a truncated title loses the end, which is
 * where the specific part usually is.
 */
const TITLE_MIN = 30;
const TITLE_MAX = 65;
const META_MIN = 70;
const META_MAX = 160;
const MIN_H2 = 2;
const MIN_SEMANTIC = 2;

/**
 * Câu có bắc cầu NHÂN QUẢ giữa hai con số hay không.
 *
 * Nhận diện bằng hình dạng, không bằng ngữ nghĩa: một câu chứa HAI con số trở
 * lên và một liên từ nhân quả nằm GIỮA chúng. Đặt cạnh nhau ("thu nhập
 * $72,727 và giá nhà $414,200") không khớp vì thiếu liên từ; "và vì thế",
 * "nên", "dẫn tới" thì khớp.
 *
 * Cố ý thô. Nó bỏ sót câu nhân quả không có liên từ ("Thu nhập cao kéo giá
 * nhà lên"), và điều đó được ghi ra đây thay vì giấu đi: phép kiểm này thu
 * hẹp bề mặt lỗi, không đóng được nó. Bỏ sót kiểu đó cần người đọc, và nói
 * thẳng là nó tồn tại thì người đọc mới biết mình còn phải đọc.
 */
const CAUSAL_WORDS =
  /\b(so|therefore|thus|hence|because|since|as a result|which (?:means|is why|explains)|drives?|drove|causes?|caused|leads? to|led to|pushes?|pushed|result(?:s|ed)? in|owing to|due to)\b/i;

export function isCausalBetweenMetrics(sentence: string): boolean {
  const numbers = [...sentence.matchAll(/\$?\d[\d,.]*\s*(?:%|billion|million|thousand)?/gi)].filter(
    (m) => m[0].replace(/[^\d]/g, "").length > 0
  );
  if (numbers.length < 2) return false;
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  const between = sentence.slice((first.index ?? 0) + first[0].length, last.index ?? sentence.length);
  return CAUSAL_WORDS.test(between);
}

export function runQc(draft: ArticleDraft, ctx: QcContext): QcReport {
  const text = textOf(draft.html);
  const checks: QcCheck[] = [];
  const on = (id: string) => ctx.rules.builtin.has(id);
  const p = (id: string, key: string, fallback: number) => ctx.rules.builtin.get(id)?.[key] ?? fallback;

  // 1. Numbers. Reuses the validator that guards market pages, unchanged — an
  //    article is held to the same numeric contract as everything else.
  const v = validateGeneratedText(text, ctx.factSet);
  if (on("facts-verified")) {
    checks.push({
      id: "facts-verified",
      label: "Mọi con số đến từ dataset",
      passed: v.passed,
      detail: v.passed
        ? `${ctx.factSet.facts.length} fact, không con số nào ngoài danh sách.`
        : v.issues.map((i) => `[${i.rule}] ${i.detail}`).join(" | "),
    });
  }

  // 2. Supply-side. The dataset measures who moves, never what movers charge
  //    or how busy they are, so a figure must not carry a claim about them.
  const bridged = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => isSupplySideBridge(s));
  if (on("no-supply-side-claim")) {
    checks.push({
      id: "no-supply-side-claim",
      label: "Không treo nhận định về nhà cung cấp lên số liệu",
      passed: bridged.length === 0,
      detail:
        bridged.length === 0
          ? "Không câu nào nối một đại lượng đo với khẳng định về công ty."
          : `${bridged.length} câu vi phạm. Sửa bằng cách hướng NGƯỜI ĐỌC (hỏi gì, xác nhận gì) thay vì khẳng định về hãng: ${bridged[0].slice(0, 120)}`,
    });
  }

  // 3. Semantic coverage.
  const hit = ctx.semanticKeywords.filter((k) => text.toLowerCase().includes(k.toLowerCase()));
  // 3. Nhân quả giữa hai chỉ số.
  //
  //    Ráp nhiều chỉ số của một nơi vào một trang mở ra đúng thứ trang một
  //    chỉ số không có: chỗ để bắc cầu. Bắc cầu là việc CẦN — "thu nhập
  //    $72,727, giá nhà $414,200" nói được điều mà từng con số riêng không
  //    nói. Nhưng nó cũng là chỗ tương quan dễ thành nhân quả nhất, và
  //    no-supply-side-claim không chặn: nó chỉ canh khẳng định về nhà cung
  //    cấp, còn "thu nhập cao NÊN người ta chuyển tới" thì nói về người dân,
  //    hoàn toàn lọt.
  //
  //    Đặt cạnh nhau thì được. Nói cái này GÂY RA cái kia thì không — dataset
  //    đo trạng thái, không đo nguyên nhân.
  const causal = text.split(/(?<=[.!?])\s+/).filter((sentence) => isCausalBetweenMetrics(sentence));
  if (on("no-metric-causation")) {
    checks.push({
      id: "no-metric-causation",
      label: "Không suy nhân quả giữa hai chỉ số",
      passed: causal.length === 0,
      detail:
        causal.length === 0
          ? "Không câu nào nói một chỉ số gây ra chỉ số khác."
          : causal.map((c) => `"${c.trim().slice(0, 120)}"`).join(" | "),
    });
  }

  if (on("semantic-coverage")) {
    checks.push({
      id: "semantic-coverage",
      label: `Có ít nhất ${p("semantic-coverage", "min", MIN_SEMANTIC)} từ khoá ngữ nghĩa`,
      passed: hit.length >= p("semantic-coverage", "min", MIN_SEMANTIC),
      detail:
        hit.length >= p("semantic-coverage", "min", MIN_SEMANTIC)
          ? `Dùng ${hit.length}: ${hit.join(", ")}`
          : `Mới có ${hit.length}/${p("semantic-coverage", "min", MIN_SEMANTIC)}. Có thể dùng: ${ctx.semanticKeywords.filter((k) => !hit.includes(k)).join(", ")}`,
    });
  }

  // 4. Internal links, checked against paths the site ACTUALLY serves.
  //
  //    A link is not internal because it starts with "/" — it is internal
  //    because it lands. The publisher shipped 10 links to 404 for exactly
  //    this reason, and those were written by code, not by a model.
  const internal = anchors(draft.html).filter((a) => a.href.startsWith("/"));
  const dead = internal.filter((a) => !ctx.knownPaths.has(a.href.replace(/\/+$/, "") || "/"));
  if (on("internal-links")) {
    checks.push({
      id: "internal-links",
      label: "Có link nội bộ, và mọi link đều tới trang có thật",
      passed: internal.length >= p("internal-links", "min", 1) && dead.length === 0,
      detail:
        internal.length === 0
          ? `Chưa có link nội bộ nào. Các trang có thật để trỏ tới: ${[...ctx.knownPaths].slice(0, 8).join(", ")}`
          : dead.length > 0
            ? `${dead.length} link trỏ vào trang KHÔNG tồn tại: ${dead.map((d) => d.href).join(", ")}`
            : `${internal.length} link nội bộ, tất cả đều tới trang có thật.`,
    });
  }

  // 5. Reserved terms. Using one is fine; using it as an anchor to somewhere
  //    other than its owner competes with the pillar page for its own term.
  const misdirected = ctx.reservedTerms.flatMap((rt) =>
    anchors(draft.html)
      .filter((a) => a.text.toLowerCase().includes(rt.term.toLowerCase()) && !a.href.includes(rt.ownedBy))
      .map((a) => `"${rt.term}" -> ${a.href} (phải là ${rt.ownedBy})`)
  );
  if (on("reserved-term-anchors")) {
    checks.push({
      id: "reserved-term-anchors",
      label: "Term dành riêng chỉ neo về trang pillar của nó",
      passed: misdirected.length === 0,
      detail: misdirected.length === 0 ? "Không anchor nào lấn term của pillar." : misdirected.join(" | "),
    });
  }

  // 6-8. Shape. Mechanical, and each one is a thing Technical SEO measured as
  //      a real defect on the live site rather than a rule from a checklist
  //      someone copied.
  if (on("title-length")) {
    checks.push({
      id: "title-length",
      label: `Tiêu đề ${p("title-length", "min", TITLE_MIN)}-${p("title-length", "max", TITLE_MAX)} ký tự`,
      passed: draft.title.length >= p("title-length", "min", TITLE_MIN) && draft.title.length <= p("title-length", "max", TITLE_MAX),
      detail: `Hiện ${draft.title.length} ký tự.`,
    });
  }
  if (on("meta-description")) {
    checks.push({
      id: "meta-description",
      label: `Meta description ${p("meta-description", "min", META_MIN)}-${p("meta-description", "max", META_MAX)} ký tự`,
      passed: draft.metaDescription.length >= p("meta-description", "min", META_MIN) && draft.metaDescription.length <= p("meta-description", "max", META_MAX),
      detail: draft.metaDescription
        ? `Hiện ${draft.metaDescription.length} ký tự.`
        : "Chưa có meta description.",
    });
  }
  const h2 = (draft.html.match(/<h2\b/gi) ?? []).length;
  if (on("heading-structure")) {
    checks.push({
      id: "heading-structure",
      label: `Ít nhất ${p("heading-structure", "min", MIN_H2)} thẻ H2`,
      passed: h2 >= p("heading-structure", "min", MIN_H2),
      detail: `Hiện ${h2} thẻ H2.`,
    });
  }

  // 9. Not a second article about the same thing. Compared against titles
  //    already on this site, because the duplication that costs is
  //    duplication within one domain.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const clash = ctx.existingTitles.find((t) => norm(t) === norm(draft.title));
  if (on("not-duplicate-title")) {
    checks.push({
      id: "not-duplicate-title",
      label: "Tiêu đề chưa từng dùng trên site này",
      passed: !clash,
      detail: clash ? `Trùng với bài đã có: "${clash}"` : "Tiêu đề chưa xuất hiện.",
    });
  }

  // Luật tự thêm: mẫu regex, chạy trên văn bản nhìn thấy được.
  for (const r of ctx.rules.custom) {
    const re = compilePattern(r.params);
    if (!re) {
      // Mẫu hỏng thì TRƯỢT, không phải bỏ qua. Bỏ qua im lặng nghĩa là người
      // vừa gõ nó tin rằng có thứ đang được canh, trong khi không.
      checks.push({ id: r.checkId, label: r.label, passed: false, detail: `Mẫu regex không hợp lệ: ${r.params.pattern}` });
      continue;
    }
    const found = re.test(text);
    const passed = r.params.mode === "must-contain" ? found : !found;
    checks.push({
      id: r.checkId,
      label: r.label,
      passed,
      detail: passed
        ? r.params.mode === "must-contain" ? "Có mẫu bắt buộc." : "Không có mẫu bị cấm."
        : r.params.mode === "must-contain"
          ? `Thiếu mẫu bắt buộc: ${r.params.pattern}`
          : `Khớp mẫu bị cấm: ${text.match(re)?.[0]?.slice(0, 80)}`,
    });
  }

  // Danh sách rỗng KHÔNG phải là đạt.
  //
  // `[].every(...)` trả về true, nên tắt hết luật sẽ cho ra một bài "đạt" mà
  // không phép kiểm nào chạy — đúng cái kiểu tín hiệu không thể tắc mà dự án
  // này liên tục bắt được. Một cổng không soi gì thì phải nói là nó không soi
  // gì, chứ không được nói là đã qua.
  if (checks.length === 0) {
    return {
      passed: false,
      checks: [
        {
          id: "checklist-empty",
          label: "Checklist có ít nhất một luật đang bật",
          passed: false,
          detail: "Mọi luật đều đang tắt trong Cài đặt, nên không phép kiểm nào chạy. Bật lại ít nhất một luật.",
        },
      ],
    };
  }

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
