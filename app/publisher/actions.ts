"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { assertValidGscProperty, listSitemaps, submitSitemap } from "@/lib/google/search-console";
import { assertValidGa4MeasurementId, assertValidGa4PropertyId } from "@/lib/google/analytics-data";
import { notifySiteConfigChanged } from "@/lib/publisher/notify-site";
import { normalizeHost } from "@/lib/publisher/link-domain";
import { getVerticalsWithMarkets } from "@/lib/queries/verticals";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function connectWebsiteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const gscPropertyUrl = String(formData.get("gscPropertyUrl") ?? "").trim();
  const ga4PropertyId = String(formData.get("ga4PropertyId") ?? "").trim();
  const wpApiBaseUrlRaw = String(formData.get("wpApiBaseUrl") ?? "").trim();
  const ga4MeasurementIdRaw = String(formData.get("ga4MeasurementId") ?? "").trim();
  const revalidateSecretRaw = String(formData.get("revalidateSecret") ?? "").trim();
  const vertical = String(formData.get("vertical") ?? "").trim();

  if (!name || !url || !gscPropertyUrl || !ga4PropertyId) {
    return { ok: false, message: "Vui lòng nhập đủ Tên, URL, GSC property, và GA4 property ID." };
  }

  // Checked here, at the only moment a person is looking at the field they
  // typed. Left to query time it surfaces as an empty dashboard days later,
  // with a 403 that reads like a permissions problem.
  /**
   * A website cannot be connected before its domain is registered.
   *
   * The order is not bureaucracy, it is the order the work actually happens
   * in: Publisher needs a verified Search Console property and a live GA4
   * stream, and neither exists until the domain resolves. Allowing a website
   * row first produces a screen full of errors that describe a site nobody
   * has finished setting up, and those errors look exactly like a broken
   * integration.
   *
   * Matched on host rather than on an id, same as the Domain <-> Publisher
   * link everywhere else — one rule, one definition of "the same site".
   */
  /**
   * Trade is required, and checked against trades that actually have markets.
   *
   * Not cosmetic validation: every content rule keyed on trade vocabulary
   * refuses to run for a trade it does not know, so a typo here produces a
   * site whose content checks silently do nothing. Rejecting at the door is
   * the only place that failure is still visible.
   */
  const knownVerticals = await getVerticalsWithMarkets();
  if (!knownVerticals.includes(vertical)) {
    return {
      ok: false,
      message: vertical
        ? `Ngành "${vertical}" chưa có market nào trong hệ thống. Đang có: ${knownVerticals.join(", ")}.`
        : `Chưa chọn ngành. Mọi luật nội dung đều tra theo ngành, nên thiếu nó thì các phép kiểm chạy mà không soi gì.`,
    };
  }

  const host = normalizeHost(url);
  const domains = await prisma.domain.findMany({ select: { name: true } });
  if (!domains.some((d) => normalizeHost(d.name) === host)) {
    return {
      ok: false,
      message:
        `Chưa đăng ký domain "${host}" ở mục Domain, nên chưa nối Publisher được. ` +
        `Thêm nó ở mục Domain trước — bước đó tạo hoặc nhập zone Cloudflare, và Publisher cần DNS đã trỏ mới lấy được số liệu.` +
        (domains.length > 0 ? ` Đang có: ${domains.map((d) => d.name).join(", ")}.` : ""),
    };
  }

  try {
    assertValidGscProperty(gscPropertyUrl);
    assertValidGa4PropertyId(ga4PropertyId);
    // Optional — but if something WAS typed, it gets checked. An empty field
    // means "no analytics yet"; a filled one that is wrong means a site that
    // reports zero forever, so the two must not be treated alike.
    if (ga4MeasurementIdRaw) assertValidGa4MeasurementId(ga4MeasurementIdRaw);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Thông tin kết nối không hợp lệ." };
  }

  try {
    await prisma.website.create({
      data: {
        name,
        url,
        vertical,
        gscPropertyUrl,
        ga4PropertyId,
        ga4MeasurementId: ga4MeasurementIdRaw || null,
        revalidateSecret: revalidateSecretRaw || null,
        wpApiBaseUrl: wpApiBaseUrlRaw || deriveWpApiBaseUrl(url),
      },
    });
    revalidatePath("/publisher");
    return { ok: true, message: `Đã kết nối "${name}".` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Kết nối thất bại." };
  }
}

export async function removeWebsiteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  try {
    await prisma.website.delete({ where: { id } });
    revalidatePath("/publisher");
    return { ok: true, message: "Đã gỡ kết nối." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Gỡ kết nối thất bại." };
  }
}

/**
 * Sets or clears a site's measurement ID after it has been connected.
 *
 * Separate from connecting because the two happen at different times and by
 * different people: a site is registered as soon as it exists, and analytics
 * often arrives days later. Requiring it up front would push someone to invent
 * a value to get past the form, and an invented measurement ID is the failure
 * this whole field exists to prevent — it collects nothing and looks fine.
 *
 * An empty submission CLEARS it rather than being rejected as invalid input.
 * Removing analytics is a real thing to want, and a field that can only be
 * filled and never emptied traps a wrong value in place.
 */
export async function updateMeasurementIdAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  const raw = String(formData.get("ga4MeasurementId") ?? "").trim();
  if (!websiteId) return { ok: false, message: "Thiếu websiteId." };

  if (raw) {
    try {
      assertValidGa4MeasurementId(raw);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "Measurement ID không hợp lệ." };
    }
  }

  try {
    const website = await prisma.website.update({
      where: { id: websiteId },
      data: { ga4MeasurementId: raw || null },
    });
    revalidatePath(`/publisher/${websiteId}`);
    revalidatePath("/publisher");

    // Saved first, notified second, and the notification's outcome is carried
    // into the message rather than assumed. "Đã lưu" alone would be true and
    // still leave someone waiting a day for a tag they think is live.
    const notify = await notifySiteConfigChanged(website);
    const saved = raw ? `Đã lưu ${raw}.` : "Đã xoá Measurement ID.";
    return { ok: true, message: `${saved} ${notify.detail}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Lưu thất bại." };
  }
}

/**
 * Sets or clears the shared secret used to notify a site of a settings change.
 *
 * WRITE-ONLY. The stored value is never sent back to the browser — the form
 * shows whether one exists, not what it is. A secret rendered into HTML so
 * someone can "see the current value" is a secret in every page cache, browser
 * history entry and screenshot from then on, and the only thing that buys is
 * saving a paste.
 *
 * TESTED ON SAVE, which is the point. A mistyped secret is silent: it sits in
 * the database looking configured, and the first sign of trouble is a
 * measurement ID that quietly fails to reach the site weeks later. So the save
 * immediately uses it for a real notification and reports what the site
 * actually said — 401 means the value is wrong and it says so now, while the
 * person who typed it is still here.
 */
export async function updateRevalidateSecretAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  const raw = String(formData.get("revalidateSecret") ?? "").trim();
  if (!websiteId) return { ok: false, message: "Thiếu websiteId." };

  try {
    const website = await prisma.website.update({
      where: { id: websiteId },
      data: { revalidateSecret: raw || null },
    });
    revalidatePath(`/publisher/${websiteId}`);

    if (!raw) {
      return {
        ok: true,
        message:
          "Đã xoá secret. Từ giờ đổi thiết lập sẽ KHÔNG báo ngay cho site được — site chỉ tự lấy khi cache hết hạn.",
      };
    }

    const notify = await notifySiteConfigChanged(website);
    return {
      ok: notify.ok,
      message: notify.ok
        ? `Đã lưu và kiểm: ${notify.detail}`
        : `Đã lưu, NHƯNG chưa dùng được. ${notify.detail}`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Lưu thất bại." };
  }
}

/**
 * Submits the site's sitemap to Search Console.
 *
 * The sitemap URL is DERIVED from the site origin rather than typed, because
 * there is exactly one right answer and asking for it invites a wrong one —
 * a typo here submits a 404 to Google, which then reports the sitemap as
 * failing and nothing about that failure points back at the typo.
 *
 * Google answers a successful submit with an empty 200, which says "accepted
 * for processing" and nothing about whether the file parses. So this re-reads
 * the list afterwards and returns what Search Console actually holds — the
 * only report worth showing.
 */
export async function submitSitemapAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  if (!websiteId) return { ok: false, message: "Thiếu websiteId." };

  try {
    const website = await prisma.website.findUniqueOrThrow({ where: { id: websiteId } });
    const sitemapUrl = `${website.url.replace(/\/+$/, "")}/sitemap.xml`;

    await submitSitemap(website.gscPropertyUrl, sitemapUrl);
    const after = await listSitemaps(website.gscPropertyUrl);
    revalidatePath(`/publisher/${websiteId}`);

    const mine = after.find((s) => s.path === sitemapUrl);
    return {
      ok: true,
      message: mine
        ? `Đã nộp ${sitemapUrl}. Search Console ghi nhận: ${mine.isPending ? "đang xử lý" : "đã xử lý"}` +
          `${mine.submittedUrls !== null ? `, ${mine.submittedUrls} URL` : ""}` +
          `${mine.errors > 0 ? `, ${mine.errors} lỗi` : ""}${mine.warnings > 0 ? `, ${mine.warnings} cảnh báo` : ""}.` +
          " Google mất vài giờ tới vài ngày mới đọc xong — con số này chưa phải kết quả cuối."
        : `Đã gửi ${sitemapUrl} nhưng Search Console CHƯA liệt kê nó. Nhiều khả năng đang xử lý; nếu sau vài phút vẫn không thấy thì kiểm lại URL sitemap.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Nộp sitemap thất bại." };
  }
}
