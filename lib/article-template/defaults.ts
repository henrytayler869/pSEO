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
  "move-underway": {
    titlePattern: "Moving to {scopeName}? Where people are actually going",
    metaPattern:
      "Federal figures for {scopeName}, with what they do and do not tell you when you are planning a move.",
    blocks: [
      { type: "paragraph", text: "If you are moving to {scopeName}, the first useful question is where other people are going — and federal records answer it directly." },
      { type: "heading", level: 2, text: "The figures for {scopeName}" },
      { type: "data-table", caption: "Measured at {measuredAt} level" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "What to ask before you book" },
      {
        type: "paragraph",
        text: "These numbers describe where people move, not what a move costs. Get a written, itemised estimate from two or three companies and confirm whether it is binding before you book.",
      },
      { type: "internal-links", heading: "Related", paths: ["/local-moving", "/long-distance-moving", "/moving-services"] },
      { type: "source-note" },
    ],
  },

  "choosing-place": {
    titlePattern: "Choosing where to live in {scopeName}: the numbers compared",
    metaPattern:
      "How {count} places in {scopeName} compare on the federal housing and income figures, and what each one leaves out.",
    blocks: [
      { type: "paragraph", text: "Comparing places in {scopeName} usually starts with price. These are the published figures, side by side." },
      { type: "heading", level: 2, text: "{scopeName} compared" },
      { type: "data-table", caption: "Measured at {measuredAt} level" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "What these figures do not cover" },
      {
        type: "paragraph",
        text: "A median is a middle, not a range: half of what is on the market sits above it. Treat these as a starting shortlist, not a valuation.",
      },
      { type: "internal-links", heading: "Related", paths: ["/moving-services", "/local-moving"] },
      { type: "source-note" },
    ],
  },

  "market-context": {
    titlePattern: "{scopeName} by the numbers: {count} places ranked",
    metaPattern: "Published federal figures for {count} places in {scopeName}, ranked, with the measurement level stated.",
    blocks: [
      { type: "heading", level: 2, text: "{scopeName} ranked" },
      { type: "data-table", caption: "Measured at {measuredAt} level" },
      { type: "ai-interpretation" },
      { type: "heading", level: 2, text: "How to read this" },
      {
        type: "paragraph",
        text: "Every figure here is published by a federal source and reproduced without adjustment. Where a number is measured for a whole county, it is the same for every ZIP code inside it.",
      },
      { type: "internal-links", heading: "Related", paths: ["/moving-services"] },
      { type: "source-note" },
    ],
  },
};
