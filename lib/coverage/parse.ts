import Papa from "papaparse";
import { CoverageRowSchema, type CoverageRow } from "./schema";

export interface ParseIssue {
  rowIndex: number; // 0-based, matches source row order
  message: string;
}

export interface ParseResult {
  rows: CoverageRow[];
  issues: ParseIssue[];
  rawRows: Record<string, unknown>[]; // exactly what was parsed, pre-validation
}

/** Parses a coverage file (CSV or JSON array) into validated rows. Never
 * throws on a bad row — bad rows are collected as issues so the caller can
 * decide whether to proceed, matching the "don't fail silently" requirement
 * that also applies to Module 2 adapters. */
export function parseCoverageFile(fileName: string, content: string): ParseResult {
  const isJson = fileName.toLowerCase().endsWith(".json");
  const rawRows: Record<string, unknown>[] = isJson
    ? JSON.parse(content)
    : Papa.parse(content, { header: true, skipEmptyLines: true }).data as Record<string, unknown>[];

  const rows: CoverageRow[] = [];
  const issues: ParseIssue[] = [];

  rawRows.forEach((raw, i) => {
    const parsed = CoverageRowSchema.safeParse(raw);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      issues.push({
        rowIndex: i,
        message: parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
      });
    }
  });

  return { rows, issues, rawRows };
}

/** A vertical is flat-rate if every row for it shares (effectively) the same
 * payoutFloor. Computed fresh on every import — never trusted from the
 * source file — because this is the fact that determines whether the
 * Market Explorer is even allowed to show a payout-ranked column. */
export function detectFlatRateVerticals(rows: CoverageRow[]): Set<string> {
  const byVertical = new Map<string, number[]>();
  for (const row of rows) {
    const list = byVertical.get(row.vertical) ?? [];
    list.push(row.payoutFloor);
    byVertical.set(row.vertical, list);
  }

  const flat = new Set<string>();
  const EPSILON = 0.005; // cents-level rounding tolerance
  for (const [vertical, payouts] of byVertical) {
    const min = Math.min(...payouts);
    const max = Math.max(...payouts);
    if (max - min <= EPSILON) flat.add(vertical);
  }
  return flat;
}
