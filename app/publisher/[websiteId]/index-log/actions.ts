"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { runRecheckFor } from "@/lib/indexing/schedule";
import { fetchUrlIndexStatus } from "@/lib/google/search-console";

export interface IndexActionResult { ok: boolean; message: string }

/** Đo lại toàn bộ URL đang theo dõi và ghi thêm một dòng log cho mỗi cái. */
export async function recheckAction(_prev: IndexActionResult, formData: FormData): Promise<IndexActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const site = await prisma.website.findUnique({ where: { id: websiteId }, select: { id: true, name: true, gscPropertyUrl: true } });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  // Đi qua CÙNG hàm mà timer gọi, với force: nút bấm và pipeline ghi vào cùng
  // một sổ. Gọi thẳng recheckAll() ở đây sẽ tạo một lần đo mà sổ chạy không
  // biết — và màn hình ngay bên dưới sẽ nói "lần đo gần nhất" là một thời
  // điểm khác với thứ người dùng vừa tự tay làm.
  // GSC property có thể chưa cấu hình (site chưa có domain). Nói ra, đừng đo
  // rỗng: "0 URL được index" và "chưa nối Search Console" là hai câu khác hẳn
  // nhau, và gộp chúng sẽ báo cáo một site chưa đo được thành một site chết.
  const gscProperty = site.gscPropertyUrl;
  if (!gscProperty) {
    return { ok: false, message: "Site này chưa cấu hình Search Console property — không đo được trạng thái index." };
  }
  const r = await runRecheckFor({ ...site, gscPropertyUrl: gscProperty }, { trigger: "manual", force: true });
  revalidatePath(`/publisher/${websiteId}/index-log`);
  if (r.error) return { ok: false, message: r.error };
  if (r.skipped) return { ok: false, message: `Không đo: ${r.skipped}` };
  return {
    ok: r.failed === 0,
    // Báo cả số hỏng, không chỉ số thành công. "Đã đo 18 URL" khi có 2 URL
    // hỏi không được là một câu đúng che mất một câu quan trọng hơn.
    message: r.failed === 0 ? `Đã đo ${r.checked} URL.` : `Đã đo ${r.checked} URL, ${r.failed} URL hỏi không được (đã ghi log là ERROR).`,
  };
}

/**
 * Ghi mốc cho URL vừa bấm tay trong Search Console.
 *
 * Ghi kèm trạng thái index ĐO ĐƯỢC tại thời điểm bấm. Không có mốc đó thì
 * lần đo sau không so được với gì, và "đã bấm rồi thấy index" tương thích
 * với cả "nút bấm có tác dụng" lẫn "thời gian trôi qua".
 */
export async function recordManualAction(_prev: IndexActionResult, formData: FormData): Promise<IndexActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const raw = String(formData.get("urls") ?? "");
  const site = await prisma.website.findUnique({ where: { id: websiteId }, select: { url: true, gscPropertyUrl: true } });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  // GSC property có thể chưa cấu hình (site chưa có domain). Nói ra, đừng đo
  // rỗng: "0 URL được index" và "chưa nối Search Console" là hai câu khác hẳn
  // nhau, và gộp chúng sẽ báo cáo một site chưa đo được thành một site chết.
  const gscProperty = site.gscPropertyUrl;
  if (!gscProperty) {
    return { ok: false, message: "Site này chưa cấu hình Search Console property — không đo được trạng thái index." };
  }
  const base = site.url.replace(/\/+$/, "");
  const urls = raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => (u.startsWith("http") ? u : `${base}${u.startsWith("/") ? "" : "/"}${u}`));
  if (urls.length === 0) return { ok: false, message: "Chưa nhập URL nào." };

  let added = 0;
  const clashes: string[] = [];
  for (const url of urls) {
    const existing = await prisma.indexSubmission.findFirst({ where: { websiteId, url }, select: { arm: true } });
    if (existing && existing.arm !== "manual") {
      // URL đã nằm trong phép thử Omega. Ghi thêm nhánh manual sẽ chồng hai
      // can thiệp và làm cả hai mất nghĩa — nên từ chối và NÓI RA, thay vì
      // lặng lẽ bỏ qua.
      clashes.push(url.replace(base, ""));
      continue;
    }
    let indexed: boolean | null = null;
    try {
      indexed = await fetchUrlIndexStatus(gscProperty, url);
    } catch {
      indexed = null;
    }
    await prisma.indexSubmission.upsert({
      where: { websiteId_url_provider: { websiteId, url, provider: "gsc-manual" } },
      create: { websiteId, url, arm: "manual", provider: "gsc-manual", indexedAtSubmit: indexed },
      update: {},
    });
    added++;
  }

  revalidatePath(`/publisher/${websiteId}/index-log`);
  if (clashes.length > 0) {
    return {
      ok: false,
      message: `Ghi ${added} URL. BỎ QUA ${clashes.length} URL đã nằm trong phép thử Omega — bấm tay vào đó làm hỏng cả hai phép đo: ${clashes.slice(0, 3).join(", ")}${clashes.length > 3 ? "…" : ""}`,
    };
  }
  return { ok: true, message: `Đã ghi ${added} URL vào nhánh bấm tay, kèm mốc trạng thái index.` };
}
