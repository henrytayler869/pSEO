"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";
import { assertValidGscProperty } from "@/lib/google/search-console";

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

  if (!name || !url || !gscPropertyUrl || !ga4PropertyId) {
    return { ok: false, message: "Vui lòng nhập đủ Tên, URL, GSC property, và GA4 property ID." };
  }

  // Checked here, at the only moment a person is looking at the field they
  // typed. Left to query time it surfaces as an empty dashboard days later,
  // with a 403 that reads like a permissions problem.
  try {
    assertValidGscProperty(gscPropertyUrl);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "GSC property không hợp lệ." };
  }

  try {
    await prisma.website.create({
      data: {
        name,
        url,
        gscPropertyUrl,
        ga4PropertyId,
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
