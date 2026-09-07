"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { deriveWpApiBaseUrl } from "@/lib/wordpress/rest-api";

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
