"use server";

import { prisma } from "@/lib/db/prisma";
import { validateTemplate } from "@/lib/article-template/validate";
import { DEFAULT_TEMPLATES } from "@/lib/article-template/defaults";
import type { ArticleTemplateShape } from "@/lib/article-template/render";

export interface TemplateActionResult {
  ok: boolean;
  message: string;
  /** Mọi lý do từ chối, để form hiện hết một lượt. */
  problems?: { where: string; message: string }[];
}

export interface TemplateRow {
  id: string | null;
  intent: string;
  name: string;
  shape: ArticleTemplateShape;
  /** true = đang dùng bản mặc định trong code, chưa có dòng nào trong DB. */
  isDefault: boolean;
  updatedAt: string | null;
}

/**
 * Template của một site, theo từng ý định.
 *
 * Ý định nào chưa được sửa thì trả về bản mặc định kèm isDefault — KHÔNG tạo
 * sẵn dòng trong DB. Gieo sẵn sẽ đóng băng bản mặc định tại thời điểm gieo:
 * lần sửa defaults.ts sau đó sẽ không tới được site nào, trong khi màn hình
 * vẫn nói "mặc định".
 */
export async function listTemplates(websiteId: string): Promise<TemplateRow[]> {
  const rows = await prisma.articleTemplate.findMany({
    where: { websiteId, isActive: true },
    orderBy: { updatedAt: "desc" },
  });
  const byIntent = new Map(rows.map((r) => [r.intent, r]));

  return Object.entries(DEFAULT_TEMPLATES).map(([intent, fallback]) => {
    const row = byIntent.get(intent);
    return row
      ? {
          id: row.id,
          intent,
          name: row.name,
          shape: row.blocks as unknown as ArticleTemplateShape,
          isDefault: false,
          updatedAt: row.updatedAt.toISOString(),
        }
      : { id: null, intent, name: `Mặc định — ${intent}`, shape: fallback, isDefault: true, updatedAt: null };
  });
}

export async function saveTemplateAction(
  _prev: TemplateActionResult,
  formData: FormData
): Promise<TemplateActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const name = String(formData.get("name") ?? "").trim() || `Template — ${intent}`;
  const raw = String(formData.get("shape") ?? "");

  let shape: ArticleTemplateShape;
  try {
    shape = JSON.parse(raw) as ArticleTemplateShape;
  } catch {
    return { ok: false, message: "Không đọc được dữ liệu template từ form." };
  }

  // Kiểm TRƯỚC khi lưu. Lưu một template hỏng rồi để writeArticle từ chối sau
  // là dời lỗi từ lúc gõ sang lúc chạy lô — người gõ đã đi khỏi màn hình.
  const problems = validateTemplate(shape);
  if (problems.length > 0) {
    return { ok: false, message: `${problems.length} chỗ phải sửa trước khi lưu được.`, problems };
  }

  const existing = await prisma.articleTemplate.findFirst({ where: { websiteId, intent, isActive: true } });
  if (existing) {
    await prisma.articleTemplate.update({
      where: { id: existing.id },
      data: { name, blocks: shape as unknown as object },
    });
  } else {
    await prisma.articleTemplate.create({
      data: { websiteId, intent, name, blocks: shape as unknown as object, isActive: true },
    });
  }

  // KHÔNG revalidatePath ở đây. Đo được trên máy 11/9/2026: revalidate dựng
  // lại cây server và cuốn theo state của useActionState, nên câu "đã lưu"
  // biến mất đúng lúc nó đúng nhất — trong khi mốc thời gian trên màn hình
  // vẫn là mốc cũ sau 5 giây. Người bấm Lưu không nhận được gì.
  //
  // Client gọi router.refresh() khi thấy ok: nó nạp lại dữ liệu server mà
  // không gỡ component, nên câu thông báo còn và mốc thời gian đổi.
  return { ok: true, message: `Đã lưu "${name}". Áp dụng cho bài viết tạo từ giờ; bài đã viết giữ nguyên.` };
}

/**
 * Quay về bản mặc định = TẮT dòng đã sửa, không xoá.
 *
 * Một template đã sinh ra bài viết đang chạy là bản ghi duy nhất về cách
 * những bài đó được dựng. Xoá nó đi thì câu hỏi "bài này ở đâu ra" mất câu
 * trả lời.
 */
export async function resetTemplateAction(
  _prev: TemplateActionResult,
  formData: FormData
): Promise<TemplateActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const rows = await prisma.articleTemplate.updateMany({
    where: { websiteId, intent, isActive: true },
    data: { isActive: false },
  });
  // Cùng lý do với saveTemplateAction: client gọi router.refresh().
  return rows.count === 0
    ? { ok: false, message: "Ý định này vốn đang dùng bản mặc định." }
    : { ok: true, message: "Đã quay về bản mặc định. Bản đã sửa được giữ lại (tắt), không xoá." };
}
