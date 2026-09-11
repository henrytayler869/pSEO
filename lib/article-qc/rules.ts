import { prisma } from "@/lib/db/prisma";

/**
 * The checklist, as rows rather than constants.
 *
 * Two kinds, and the difference is not cosmetic:
 *
 *   BUILT-IN — the predicate is code. Settings can deactivate it and change
 *   its thresholds; it cannot change what the predicate inspects.
 *   `facts-verified` runs the validator, and no JSON edit makes it inspect
 *   something else.
 *
 *   CUSTOM — the predicate IS the data: a regex that must appear, or must not.
 *   That is genuinely addable without a deploy, and it is the honest extent of
 *   what "add a rule" can mean in a text field.
 *
 * Offering a free-form "add any rule" button would be a lie that only surfaces
 * the day somebody relies on a rule that never ran.
 */

export type RuleKind = "content" | "technical";

export interface BuiltinRuleRow {
  checkId: string;
  kind: RuleKind;
  label: string;
  why: string;
  params: Record<string, number>;
}

/**
 * The nine coded checks, with the thresholds Settings may move.
 *
 * There is deliberately no minimum word count. One existed and was removed
 * 2026-09-11: the default templates produce 107, 92 and 77 words, so every
 * article built from them failed a check written before the templates existed.
 * Length is not the property that matters; whether every figure is real,
 * sourced and correctly scoped is, and those have their own checks.
 */
export const BUILTIN_RULES: BuiltinRuleRow[] = [
  { checkId: "facts-verified", kind: "content", label: "Mọi con số đến từ dataset", why: "Một con số không có trong fact set là con số model tự nghĩ ra.", params: {} },
  { checkId: "no-supply-side-claim", kind: "content", label: "Không treo nhận định về nhà cung cấp lên số liệu", why: "Không nguồn nào ở đây đo giá cước hay mức bận của hãng.", params: {} },
  { checkId: "no-metric-causation", kind: "content", label: "Không suy nhân quả giữa hai chỉ số", why: "Dataset đo trạng thái, không đo nguyên nhân. Đặt hai con số cạnh nhau thì được; nói cái này gây ra cái kia thì không.", params: {} },
  { checkId: "semantic-coverage", kind: "content", label: "Đủ từ khoá ngữ nghĩa", why: "Bài không chạm từ khoá nào của ngành thì không ai tìm thấy.", params: { min: 2 } },
  { checkId: "internal-links", kind: "technical", label: "Có link nội bộ, và mọi link tới trang có thật", why: "Một link là nội bộ vì nó ĐÁP, không phải vì nó bắt đầu bằng gạch chéo.", params: { min: 1 } },
  { checkId: "reserved-term-anchors", kind: "content", label: "Term dành riêng chỉ neo về trang pillar của nó", why: "Anchor lấn term sẽ cạnh tranh với chính trang pillar.", params: {} },
  { checkId: "title-length", kind: "technical", label: "Độ dài tiêu đề", why: "Google cắt quanh 65 ký tự, và phần bị cắt thường là phần cụ thể.", params: { min: 30, max: 65 } },
  { checkId: "meta-description", kind: "technical", label: "Độ dài meta description", why: "Thiếu hoặc quá ngắn thì Google tự bịa đoạn mô tả.", params: { min: 70, max: 160 } },
  { checkId: "heading-structure", kind: "technical", label: "Số thẻ H2 tối thiểu", why: "Một bài không có mục là một bài không ai lướt được.", params: { min: 2 } },
  { checkId: "not-duplicate-title", kind: "content", label: "Tiêu đề chưa dùng trên site này", why: "Hai bài cùng tiêu đề trên một domain cạnh tranh với nhau.", params: {} },
];

export interface CustomRuleParams {
  mode: "must-contain" | "must-not-match";
  pattern: string;
  flags?: string;
}

export interface ActiveRules {
  /** checkId -> thresholds, for the coded checks that are ON. */
  builtin: Map<string, Record<string, number>>;
  custom: { checkId: string; label: string; why: string; params: CustomRuleParams }[];
}

/**
 * Seeds the nine built-ins on first read, then returns what is active.
 *
 * Seeded rather than shipped as an empty table: an empty checklist page gives
 * no way to find out what the checks even are, and an empty checklist passes
 * everything — which is the most dangerous default a gate can have.
 *
 * Existing rows are never overwritten. A threshold someone moved in Settings
 * must survive the next deploy, or Settings was decoration.
 */
export async function loadActiveRules(): Promise<ActiveRules> {
  const existing = await prisma.qcRule.findMany({ select: { checkId: true } });
  const have = new Set(existing.map((r) => r.checkId));
  const missing = BUILTIN_RULES.filter((r) => !have.has(r.checkId));
  if (missing.length > 0) {
    await prisma.qcRule.createMany({
      data: missing.map((r, i) => ({
        kind: r.kind,
        checkId: r.checkId,
        label: r.label,
        why: r.why,
        builtin: true,
        isActive: true,
        params: r.params,
        sortOrder: i,
      })),
      skipDuplicates: true,
    });
  }

  const rows = await prisma.qcRule.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const builtin = new Map<string, Record<string, number>>();
  const custom: ActiveRules["custom"] = [];
  for (const r of rows) {
    if (r.builtin) builtin.set(r.checkId, (r.params ?? {}) as Record<string, number>);
    else custom.push({ checkId: r.checkId, label: r.label, why: r.why, params: r.params as unknown as CustomRuleParams });
  }
  return { builtin, custom };
}

/**
 * A custom rule's regex, or null when it does not compile.
 *
 * Null is handled by the caller as a FAILING check, not a skipped one. A rule
 * whose pattern is broken must be loud: skipping it silently would mean the
 * person who typed it believes something is being enforced that is not — the
 * failure mode this whole project keeps finding.
 */
export function compilePattern(p: CustomRuleParams): RegExp | null {
  try {
    return new RegExp(p.pattern, p.flags ?? "i");
  } catch {
    return null;
  }
}
