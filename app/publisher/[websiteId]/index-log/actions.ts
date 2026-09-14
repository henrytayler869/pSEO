"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { recheckAll } from "@/lib/indexing/log";
import { fetchUrlIndexStatus } from "@/lib/google/search-console";

export interface IndexActionResult { ok: boolean; message: string }

/** Đo lại toàn bộ URL đang theo dõi và ghi thêm một dòng log cho mỗi cái. */
export async function recheckAction(_prev: IndexActionResult, formData: FormData): Promise<IndexActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const site = await prisma.website.findUnique({ where: { id: websiteId }, select: { gscPropertyUrl: true } });
  if (!site) return { ok: false, message: "Không tìm thấy website." };
  try {
    const { checked, failed } = await recheckAll(websiteId, site.gscPropertyUrl);
    revalidatePath(`/publisher/${websiteId}/index-log`);
    return {
      ok: failed === 0,
      // Báo cả số hỏng, không chỉ số thành công. "Đã đo 18 URL" khi có 2 URL
      // hỏi không được là một câu đúng che mất một câu quan trọng hơn.
      message: failed === 0 ? `Đã đo ${checked} URL.` : `Đã đo ${checked} URL, ${failed} URL hỏi không được (đã ghi log là ERROR).`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message.split("\n")[0] : "Đo thất bại." };
  }
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
      indexed = await fetchUrlIndexStatus(site.gscPropertyUrl, url);
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
