"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";
import { createOnPageTask, ON_PAGE_COST_PER_PAGE_USD } from "@/lib/dataforseo/on-page";
import { notifySiteConfigChanged } from "@/lib/publisher/notify-site";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Starts an OnPage crawl. This is the one action here that spends money.
 *
 * maxPages arrives from the form rather than from a constant, and is clamped
 * server-side: the form is a suggestion, and a crawl limit is exactly the kind
 * of number that must not be settable to anything a request feels like sending.
 */
export async function startOnPageCrawlAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  const requested = Number(formData.get("maxPages") ?? 0);
  if (!websiteId) return { ok: false, message: "Thiếu websiteId." };

  const MAX_ALLOWED = 5000;
  if (!Number.isFinite(requested) || requested < 1) {
    return { ok: false, message: "Số trang tối đa phải là một số dương." };
  }
  const maxPages = Math.min(Math.floor(requested), MAX_ALLOWED);

  try {
    const website = await prisma.website.findUniqueOrThrow({ where: { id: websiteId } });
    const [login, password] = await Promise.all([
      getCredential("DATAFORSEO_LOGIN"),
      getCredential("DATAFORSEO_PASSWORD"),
    ]);
    if (!login || !password) {
      return { ok: false, message: "Chưa cấu hình DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD ở trang Cài đặt." };
    }

    /**
     * Purge the edge BEFORE crawling.
     *
     * The site sits behind Cloudflare with s-maxage=86400, so a crawl started
     * against a warm edge reports on HTML that can be a full day old. The
     * findings would be real, and about a build that no longer exists —
     * sending someone to hunt a bug in current code that was fixed yesterday.
     *
     * Reuses the site's own /api/revalidate, which purges the whole zone. Not
     * fatal when it fails: a crawl of slightly stale HTML is still worth more
     * than no crawl, and the outcome is reported so nobody reads the results
     * as fresher than they are.
     */
    const purge = await notifySiteConfigChanged(website);

    const taskId = await createOnPageTask(login, password, website.url, maxPages);
    await prisma.website.update({
      where: { id: websiteId },
      data: { onPageTaskId: taskId, onPageTaskAt: new Date(), onPageMaxPages: maxPages },
    });
    revalidatePath(`/publisher/${websiteId}/onpage`);

    const cost = (maxPages * ON_PAGE_COST_PER_PAGE_USD * 100).toFixed(2);
    return {
      ok: true,
      message:
        `Đã bắt đầu quét tối đa ${maxPages} trang (tối đa ${cost} cent — chỉ tính số trang thực sự quét được). ` +
        `Task ${taskId}. Quét chạy nền vài phút; tải lại trang để xem tiến độ.` +
        (requested > MAX_ALLOWED ? ` Đã giới hạn từ ${requested} xuống ${MAX_ALLOWED}.` : "") +
        (purge.ok
          ? " Đã xoá cache Cloudflare trước khi quét, nên kết quả nói về bản build hiện tại."
          : ` CẢNH BÁO: chưa xoá được cache Cloudflare (${purge.detail}) — HTML ở edge có thể cũ tới 24 giờ, và kết quả quét sẽ nói về bản build cũ đó chứ không phải bản hiện tại.`),
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Không bắt đầu được lần quét." };
  }
}
