import type { ArticleTemplateShape } from "./render";

/**
 * The template a publisher starts with, one per intent.
 *
 * A starting point, not a rule — these live in the database and are meant to
 * be edited per site. They exist because an empty template editor is a worse
 * first experience than a filled one somebody disagrees with: disagreeing with
 * something concrete is how a person finds out what they actually want.
 *
 * Each obeys assertTemplate: exactly one ai-interpretation, a data-table, and a
 * source-note.
 */
export const DEFAULT_TEMPLATES: Record<string, ArticleTemplateShape> = {
  /**
   * commercial — nhóm lớn nhất (410 thị trường, 2.3 triệu lượt tìm/tháng).
   *
   * Người đọc đang so sánh trước khi thuê, nên bài mở bằng số liệu của nơi đó
   * rồi chuyển sang thứ cần hỏi khi lấy báo giá. Không câu nào nói về hãng
   * nào, giá cước hay lịch trống — không nguồn nào ở đây đo những thứ đó.
   */
  commercial: {
    titlePattern: "Moving services in {city}, {state} {zip}",
    metaPattern:
      "Census and IRS figures for {city}, {state} — {count} measured indicators to read before you compare moving quotes.",
    blocks: [
      {
        type: "paragraph",
        text: "Before comparing quotes for a move in {city}, it helps to know what the published figures say about the area. They are below, each labelled with the area it was measured for.",
      },
      { type: "heading", level: 2, text: "The figures for {city}, {state}" },
      { type: "data-table", caption: "Each figure is labelled with the area it was measured for" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "What to ask when you compare quotes" },
      {
        type: "paragraph",
        text: "These numbers describe the area, not what a move costs. When you compare local moving services, ask what the quoted moving services prices include, get the estimate itemised in writing, and confirm whether it is binding before you book.",
      },
      { type: "internal-links", heading: "Related", paths: ["/local-moving", "/long-distance-moving", "/moving-services"] },
      { type: "source-note" },
    ],
  },

  "transactional": {
    titlePattern: "Book your move in {city}, {state} {zip}",
    metaPattern:
      "Census and IRS figures for {city}, {state} — {count} measured indicators, each with the area it describes.",
    blocks: [
      { type: "paragraph", text: "If you are moving to {city}, published federal figures already describe the area — how much people earn, what homes cost, who owns and how many households arrive each year. They are below, each labelled with the area it was measured for." },
      { type: "heading", level: 2, text: "The figures for {city}, {state}" },
      { type: "data-table", caption: "Each figure is labelled with the area it was measured for" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "What to ask before you book" },
      {
        type: "paragraph",
        text: "These numbers describe where people move, not what a move costs. If you are lining up moving help, compare local moving services and ask what the quoted moving services prices cover before you book.",
      },
      { type: "internal-links", heading: "Related", paths: ["/local-moving", "/long-distance-moving", "/moving-services"] },
      { type: "source-note" },
    ],
  },

  "informational": {
    titlePattern: "Moving in {city}, {state} {zip}: the published figures",
    metaPattern:
      "{count} federal figures for {city}, {state} — home values, household income, ownership and how many people move each year.",
    blocks: [
      { type: "paragraph", text: "Deciding on {city} usually starts with what a home costs and what households earn. Both are published figures, and both are below alongside everything else measured for this area." },
      { type: "heading", level: 2, text: "What is measured for {city}, {state}" },
      { type: "data-table", caption: "Each figure is labelled with the area it was measured for" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "What these figures do not cover" },
      {
        type: "paragraph",
        text: "A median is the middle value, not a range — the market runs above it and below it. Treat these as a starting shortlist, not a valuation. If you are already lining up moving help, compare local moving services separately — nothing here measures what any company charges.",
      },
      { type: "internal-links", heading: "Related", paths: ["/moving-services", "/local-moving"] },
      { type: "source-note" },
    ],
  },

  "navigational": {
    titlePattern: "{city}, {state} {zip}: moving and housing figures",
    metaPattern: "Published federal figures for {city}, {state}: {count} indicators, each with the area it was measured for.",
    blocks: [
      { type: "heading", level: 2, text: "{city}, {state}: the measured figures" },
      { type: "data-table", caption: "Each figure is labelled with the area it was measured for" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "How to read this" },
      {
        type: "paragraph",
        text: "Every figure here is published by a federal source and reproduced without adjustment. Where a number is measured for a whole county, it is the same for every ZIP code inside it. For moving help in this area, compare local moving services directly — no figure below measures them.",
      },
      { type: "internal-links", heading: "Related", paths: ["/moving-services"] },
      { type: "source-note" },
    ],
  },
};
