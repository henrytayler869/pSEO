"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { assertValidGscProperty } from "@/lib/google/search-console";
import { assertValidGa4MeasurementId, assertValidGa4PropertyId } from "@/lib/google/analytics-data";
import { notifySiteConfigChanged } from "@/lib/publisher/notify-site";

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

  if (!name || !url || !gscPropertyUrl || !ga4PropertyId) {
    return { ok: false, message: "Vui lòng nhập đủ Tên, URL, GSC property, và GA4 property ID." };
  }

  // Checked here, at the only moment a person is looking at the field they
  // typed. Left to query time it surfaces as an empty dashboard days later,
  // with a 403 that reads like a permissions problem.
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
        gscPropertyUrl,
        ga4PropertyId,
        ga4MeasurementId: ga4MeasurementIdRaw || null,
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
