"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getTrafficVerticalSummaries } from "@/lib/queries/traffic-research";
import { getCredential } from "@/lib/settings/credentials";
import { createCloudflareZone, getCloudflareZone, CloudflareApiError } from "@/lib/cloudflare/zones";

export interface ActionResult {
  ok: boolean;
  message: string;
}

async function getCloudflareCredentials(): Promise<{ apiToken: string; accountId: string } | { error: string }> {
  const [apiToken, accountId] = await Promise.all([
    getCredential("CLOUDFLARE_API_TOKEN"),
    getCredential("CLOUDFLARE_ACCOUNT_ID"),
  ]);
  if (!apiToken || !accountId) {
    return {
      error:
        "Chưa cấu hình CLOUDFLARE_API_TOKEN và/hoặc CLOUDFLARE_ACCOUNT_ID (ở trang Cài đặt) — không thể thêm domain vào Cloudflare.",
    };
  }
  return { apiToken, accountId };
}

/** Adds a real domain to the app AND creates a real zone for it in
 * Cloudflare — not a placeholder record. If the Cloudflare call fails (bad
 * token, domain already exists in another Cloudflare account, etc.), the
 * Domain row is still saved with the error attached (never silently
 * dropped) so it stays visible in the list and can be retried via
 * refreshDomainAction once the underlying issue is fixed. */
export async function addDomainAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim().toLowerCase();
  const relevantVertical = String(formData.get("relevantVertical") ?? "").trim() || null;

  if (!name) {
    return { ok: false, message: "Vui lòng nhập tên domain." };
  }

  /**
   * The dropdown constrains the choice; this enforces it.
   *
   * A <select> is a suggestion, not a boundary — the form posts whatever it is
   * told to, and a value that never appeared in the list would be stored
   * silently and match no niche anywhere. Validating server-side is what makes
   * the dropdown mean something rather than decorate the page.
   *
   * The message names the niches that DO exist. "Không hợp lệ" leaves someone
   * comparing their spelling against a list they cannot see.
   */
  if (relevantVertical) {
    const researched = await getTrafficVerticalSummaries();
    const known = researched.map((n) => n.vertical);
    if (!known.includes(relevantVertical)) {
      return {
        ok: false,
        message:
          `Niche "${relevantVertical}" chưa được nghiên cứu nên không gắn được. ` +
          (known.length > 0
            ? `Đang có: ${known.join(", ")}.`
            : "Hiện chưa niche nào có thị trường được chấm điểm traffic."),
      };
    }
  }

  const creds = await getCloudflareCredentials();
  if ("error" in creds) {
    return { ok: false, message: creds.error };
  }

  try {
    const zone = await createCloudflareZone(name, creds.apiToken, creds.accountId);
    await prisma.domain.create({
      data: {
        name,
        relevantVertical,
        cloudflareZoneId: zone.id,
        cloudflareStatus: zone.status,
        nameServers: zone.nameServers,
        cloudflareError: null,
        lastCheckedAt: new Date(),
      },
    });
    revalidatePath("/domains");
    return {
      ok: true,
      message: `Đã thêm "${name}" vào Cloudflare (trạng thái: ${zone.status}). Trỏ nameserver tại registrar sang: ${zone.nameServers.join(", ")}.`,
    };
  } catch (err) {
    const message = err instanceof CloudflareApiError || err instanceof Error ? err.message : "Thêm domain vào Cloudflare thất bại.";
    await prisma.domain.create({
      data: { name, relevantVertical, cloudflareError: message, lastCheckedAt: new Date() },
    });
    revalidatePath("/domains");
    return { ok: false, message: `Đã lưu "${name}" nhưng thêm vào Cloudflare thất bại: ${message}` };
  }
}

/** Re-checks a Domain's Cloudflare status: if it never got a zone (previous
 * add failed), retries creating one; otherwise refreshes status/nameservers
 * for the existing zone (e.g. initializing -> active once nameservers
 * propagate at the registrar). */
export async function refreshDomainAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const domain = await prisma.domain.findUnique({ where: { id } });
  if (!domain) return { ok: false, message: "Không tìm thấy domain." };

  const creds = await getCloudflareCredentials();
  if ("error" in creds) return { ok: false, message: creds.error };

  try {
    const zone = domain.cloudflareZoneId
      ? await getCloudflareZone(domain.cloudflareZoneId, creds.apiToken)
      : await createCloudflareZone(domain.name, creds.apiToken, creds.accountId);

    await prisma.domain.update({
      where: { id },
      data: {
        cloudflareZoneId: zone.id,
        cloudflareStatus: zone.status,
        nameServers: zone.nameServers,
        cloudflareError: null,
        lastCheckedAt: new Date(),
      },
    });
    revalidatePath("/domains");
    return { ok: true, message: `Trạng thái hiện tại: ${zone.status}.` };
  } catch (err) {
    const message = err instanceof CloudflareApiError || err instanceof Error ? err.message : "Kiểm tra trạng thái thất bại.";
    await prisma.domain.update({ where: { id }, data: { cloudflareError: message, lastCheckedAt: new Date() } });
    revalidatePath("/domains");
    return { ok: false, message };
  }
}

/** Removes the Domain row from this app only — does NOT delete the zone on
 * Cloudflare. Deleting a live Cloudflare zone is a separate, destructive,
 * hard-to-reverse action (drops DNS records) that a "remove from list"
 * button should never do silently. */
export async function removeDomainAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  try {
    await prisma.domain.delete({ where: { id } });
    revalidatePath("/domains");
    return { ok: true, message: "Đã gỡ khỏi danh sách (không xoá zone trên Cloudflare, nếu có)." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Gỡ thất bại." };
  }
}
