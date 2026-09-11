"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { loadActiveRules, compilePattern, BUILTIN_RULES, type CustomRuleParams } from "@/lib/article-qc/rules";

export interface QcRuleActionResult {
  ok: boolean;
  message: string;
}

export interface QcRuleRow {
  id: string;
  kind: string;
  checkId: string;
  label: string;
  why: string;
  builtin: boolean;
  isActive: boolean;
  params: Record<string, unknown>;
}

/** Đọc để hiển thị: gọi loadActiveRules trước để bảng được gieo built-in,
 * rồi đọc CẢ luật đang tắt — trang cài đặt phải thấy thứ nó cần bật lại. */
export async function listQcRules(): Promise<QcRuleRow[]> {
  await loadActiveRules();
  const rows = await prisma.qcRule.findMany({ orderBy: [{ builtin: "desc" }, { sortOrder: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    checkId: r.checkId,
    label: r.label,
    why: r.why,
    builtin: r.builtin,
    isActive: r.isActive,
    params: (r.params ?? {}) as Record<string, unknown>,
  }));
}

export async function toggleQcRuleAction(_prev: QcRuleActionResult, formData: FormData): Promise<QcRuleActionResult> {
  const id = String(formData.get("id") ?? "");
  const row = await prisma.qcRule.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Không thấy luật này." };
  await prisma.qcRule.update({ where: { id }, data: { isActive: !row.isActive } });
  revalidatePath("/settings");
  return {
    ok: true,
    message: row.isActive
      ? `Đã TẮT "${row.label}". Mục này sẽ không còn xuất hiện trong báo cáo QC của bài viết mới.`
      : `Đã BẬT "${row.label}".`,
  };
}

export async function saveQcThresholdsAction(_prev: QcRuleActionResult, formData: FormData): Promise<QcRuleActionResult> {
  const id = String(formData.get("id") ?? "");
  const row = await prisma.qcRule.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Không thấy luật này." };

  const defaults = BUILTIN_RULES.find((r) => r.checkId === row.checkId)?.params ?? {};
  const next: Record<string, number> = {};
  for (const key of Object.keys(defaults)) {
    const raw = formData.get(key);
    const n = Number(raw);
    // Ô trống hoặc không phải số thì GIỮ giá trị cũ. Coi nó là 0 sẽ biến một
    // lần lỡ tay thành một phép kiểm luôn đạt mà không báo gì.
    if (raw === null || String(raw).trim() === "" || !Number.isFinite(n)) {
      next[key] = ((row.params ?? {}) as Record<string, number>)[key] ?? defaults[key];
      continue;
    }
    if (n < 0) return { ok: false, message: `Ngưỡng "${key}" không thể âm.` };
    next[key] = Math.round(n);
  }
  if (next.min !== undefined && next.max !== undefined && next.min > next.max) {
    return { ok: false, message: `min (${next.min}) lớn hơn max (${next.max}) — không giá trị nào lọt qua được.` };
  }

  await prisma.qcRule.update({ where: { id }, data: { params: next } });
  revalidatePath("/settings");
  return { ok: true, message: `Đã lưu ngưỡng cho "${row.label}": ${JSON.stringify(next)}.` };
}

export async function addCustomQcRuleAction(_prev: QcRuleActionResult, formData: FormData): Promise<QcRuleActionResult> {
  const label = String(formData.get("label") ?? "").trim();
  const why = String(formData.get("why") ?? "").trim();
  const pattern = String(formData.get("pattern") ?? "").trim();
  const mode = String(formData.get("mode") ?? "must-not-match");
  const kind = String(formData.get("kind") ?? "content");

  if (!label) return { ok: false, message: "Cần tên hiển thị." };
  if (!pattern) return { ok: false, message: "Cần mẫu regex." };
  if (mode !== "must-contain" && mode !== "must-not-match") return { ok: false, message: "Chế độ không hợp lệ." };

  const params: CustomRuleParams = { mode, pattern };
  // Kiểm mẫu TRƯỚC khi lưu. Lưu một mẫu hỏng rồi để nó làm trượt mọi bài là
  // biến một lỗi gõ nhầm thành một lô bài viết hỏng.
  if (compilePattern(params) === null) {
    return { ok: false, message: `Regex không hợp lệ: ${pattern}` };
  }

  const checkId = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 60);
  if (await prisma.qcRule.findUnique({ where: { checkId } })) {
    return { ok: false, message: `Đã có luật tên "${label}".` };
  }

  const last = await prisma.qcRule.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await prisma.qcRule.create({
    data: {
      kind,
      checkId,
      label,
      why: why || "(chưa ghi lý do)",
      builtin: false,
      isActive: true,
      params: params as unknown as object,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  revalidatePath("/settings");
  return { ok: true, message: `Đã thêm "${label}". Áp dụng cho bài viết tạo từ giờ trở đi, KHÔNG kiểm lại bài cũ.` };
}

/**
 * Xoá chỉ áp dụng cho luật tự thêm. Luật built-in thì TẮT, không xoá: xoá nó
 * khỏi bảng chỉ khiến lần đọc sau gieo lại nó ở trạng thái bật — nút "xoá" mà
 * kết quả là luật quay lại còn tệ hơn không có nút.
 */
export async function deleteCustomQcRuleAction(_prev: QcRuleActionResult, formData: FormData): Promise<QcRuleActionResult> {
  const id = String(formData.get("id") ?? "");
  const row = await prisma.qcRule.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "Không thấy luật này." };
  if (row.builtin) return { ok: false, message: "Luật dựng sẵn không xoá được — hãy TẮT nó." };
  await prisma.qcRule.delete({ where: { id } });
  revalidatePath("/settings");
  return { ok: true, message: `Đã xoá "${row.label}".` };
}
