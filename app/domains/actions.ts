"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getTrafficVerticalSummaries } from "@/lib/queries/traffic-research";
import { getCredential } from "@/lib/settings/credentials";
import { createCloudflareZone, getCloudflareZone, findCloudflareZoneByName, CloudflareApiError } from "@/lib/cloudflare/zones";

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
/**
 * Wrapper that guarantees this action RETURNS rather than throws.
 *
 * useActionState keeps the previous state when a server action throws, so an
 * uncaught error renders as nothing at all: the button finishes, no message
 * appears, and the form looks like it was ignored. That is the least
 * debuggable outcome available, and it is what a validation query added
 * outside the try block produced — a lookup that had nothing to do with
 * Cloudflare could silently swallow the entire submission.
 *
 * Everything the user can trigger now ends in a message. An unexpected failure
 * says so, with the actual error text, instead of leaving someone clicking a
 * button that appears to do nothing.
 */
export async function addDomainAction(prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    return await addDomain(prev, formData);
  } catch (err) {
    return {
      ok: false,
      message: `Lỗi không lường trước khi thêm domain: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function addDomain(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
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
    // Its own try/catch as well as the wrapper above: if the niche list cannot
    // be read, that must not block adding a domain. The list is a convenience
    // for picking a value, not a gate the whole feature depends on.
    let known: string[];
    try {
      known = (await getTrafficVerticalSummaries()).map((n) => n.vertical);
    } catch (err) {
      return {
        ok: false,
        message: `Không đọc được danh sách niche để kiểm tra: ${err instanceof Error ? err.message : String(err)}. Bỏ trống ô niche rồi thêm lại, gắn niche sau.`,
      };
    }
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

  /**
   * "Thêm domain" and "create a Cloudflare zone" are not the same request.
   *
   * A domain bought and pointed at Cloudflare months ago is ALREADY a zone.
   * Asking Cloudflare to create it again is refused — correctly — and the
   * refusal used to be reported as a failure, leaving a row with an error on
   * it and no zone id, for a domain that was working perfectly.
   *
   * So: look for an existing zone FIRST. Creating is what happens when there
   * is nothing to adopt, not the default that everything else is an exception
   * to.
   *
   * The two outcomes are reported as DIFFERENT things. "Đã tạo" and "đã nhập"
   * lead to different next steps — a created zone needs its nameservers
   * pointed at Cloudflare, an adopted one already has them — and a message
   * that says "added" for both would send someone to change DNS that is
   * already correct.
   */
  let zone: Awaited<ReturnType<typeof createCloudflareZone>>;
  let imported: boolean;
  try {
    const existing = await findCloudflareZoneByName(name, creds.apiToken);
    if (existing) {
      zone = existing;
      imported = true;
    } else {
      zone = await createCloudflareZone(name, creds.apiToken, creds.accountId);
      imported = false;
    }
  } catch (err) {
    const message = err instanceof CloudflareApiError || err instanceof Error ? err.message : "Thêm domain vào Cloudflare thất bại.";
    await prisma.domain.create({
      data: { name, relevantVertical, cloudflareError: message, lastCheckedAt: new Date() },
    });
    revalidatePath("/domains");
    return { ok: false, message: `Đã lưu "${name}" nhưng thêm vào Cloudflare thất bại: ${message}` };
  }

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
    message: imported
      ? `Đã NHẬP zone có sẵn của "${name}" (trạng thái: ${zone.status}). Zone này đã tồn tại trên Cloudflare từ trước — không tạo mới, không đụng gì tới DNS đang chạy. Nameserver hiện tại: ${zone.nameServers.join(", ")}.`
      : `Đã TẠO zone mới cho "${name}" (trạng thái: ${zone.status}). Cần trỏ nameserver tại registrar sang: ${zone.nameServers.join(", ")}.`,
  };
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
    // Same order as adding: adopt before creating. A row that failed to add
    // earlier has no zone id, and re-checking it used to jump straight to
    // "create" — which is the one thing that cannot work for a domain whose
    // zone already exists, i.e. exactly the rows most likely to be sitting
    // here with an error on them.
    const zone = domain.cloudflareZoneId
      ? await getCloudflareZone(domain.cloudflareZoneId, creds.apiToken)
      : ((await findCloudflareZoneByName(domain.name, creds.apiToken)) ??
        (await createCloudflareZone(domain.name, creds.apiToken, creds.accountId)));

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
