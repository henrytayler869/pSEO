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
    titlePattern: "Moving to {city}, {state}? What the local figures show",
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
        text: "These numbers describe where people move, not what a move costs. Get a written, itemised estimate from two or three companies and confirm whether it is binding before you book.",
      },
      { type: "internal-links", heading: "Related", paths: ["/local-moving", "/long-distance-moving", "/moving-services"] },
      { type: "source-note" },
    ],
  },

  "choosing-place": {
    titlePattern: "Living in {city}, {state}: homes, income and who owns",
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
        text: "A median is a middle, not a range: half of what is on the market sits above it. Treat these as a starting shortlist, not a valuation.",
      },
      { type: "internal-links", heading: "Related", paths: ["/moving-services", "/local-moving"] },
      { type: "source-note" },
    ],
  },

  "market-context": {
    titlePattern: "{city}, {state} by the numbers",
    metaPattern: "Published federal figures for {city}, {state}: {count} indicators, each with the area it was measured for.",
    blocks: [
      { type: "heading", level: 2, text: "{city}, {state}: the measured figures" },
      { type: "data-table", caption: "Each figure is labelled with the area it was measured for" },
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
