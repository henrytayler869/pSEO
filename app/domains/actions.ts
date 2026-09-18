"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getTrafficVerticalSummaries } from "@/lib/queries/traffic-research";
import { getCredential } from "@/lib/settings/credentials";
import { setNameservers } from "@/lib/registrar/gname";
import { createCloudflareZone, getCloudflareZone, findCloudflareZoneByName, CloudflareApiError } from "@/lib/cloudflare/zones";
import { provisionSite, type StepResult } from "@/lib/publisher/provision";

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

  /**
   * `cloudflareError` chỉ được mang lỗi CỦA CLOUDFLARE.
   *
   * Trước đây khối try bọc luôn `revalidatePath` và lệnh return, nên bất kỳ
   * hỏng hóc nào xảy ra SAU khi zone đã tạo xong cũng bị ghi vào ô đó. Đo
   * được ngày 15/9/2026: zone `theaccidentrecord.com` tạo thành công, hàng
   * lưu đúng zone id và nameserver, nhưng màn hình hiện huy hiệu "Lỗi" kèm
   * "Invariant: static generation store missing in revalidatePath /domains".
   *
   * Đó là kiểu sai tệ hơn im lặng: nó bảo người ta đi sửa Cloudflare cho một
   * việc Cloudflare đã làm xong. Nên phạm vi của try bây giờ dừng đúng ở chỗ
   * cuối cùng mà Cloudflare còn liên quan.
   */
  let zoneStatus: string;
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
    zoneStatus = zone.status;
  } catch (err) {
    const message = err instanceof CloudflareApiError || err instanceof Error ? err.message : "Kiểm tra trạng thái thất bại.";
    await prisma.domain.update({ where: { id }, data: { cloudflareError: message, lastCheckedAt: new Date() } });
    revalidatePath("/domains");
    return { ok: false, message };
  }

  revalidatePath("/domains");
  return { ok: true, message: `Trạng thái hiện tại: ${zoneStatus}.` };
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

/**
 * Đặt nameserver Cloudflare cho domain tại registrar Gname.
 *
 * Tách thành hành động RIÊNG, không gộp vào addDomainAction. Ba lý do:
 * Gname lọc theo IP nên lời gọi chỉ chạy được từ production; nhiều domain đã
 * trỏ nameserver từ trước và gọi lại là thừa; và một domain có thể được thêm
 * trước khi ai đó cấu hình khoá Gname. Gộp vào sẽ khiến "thêm domain" thất
 * bại vì một bước không phải lúc nào cũng cần.
 */
export async function setRegistrarNameserversAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const domain = await prisma.domain.findUnique({
    where: { id },
    select: { name: true, nameServers: true },
  });
  if (!domain) return { ok: false, message: "Không tìm thấy domain." };

  const result = await setNameservers({ domain: domain.name, nameServers: domain.nameServers });
  revalidatePath("/domains");
  return { ok: result.ok, message: result.detail };
}

export interface ProvisionActionResult {
  ok: boolean;
  message: string;
  steps: StepResult[];
  manual: { title: string; commands: string[] }[];
}

/**
 * Dựng site từ một domain đã có zone.
 *
 * XÁC NHẬN BẰNG CHÍNH TÊN MIỀN, không phải một hộp thoại "bạn có chắc không".
 * Bước này tạo GA4 property thật, ghi A record thật, và cấp khoá thật — gõ lại
 * tên miền là cách rẻ nhất để phân biệt "tôi định bấm cái này" với "tôi vừa
 * bấm nhầm hàng".
 *
 * KHÔNG dừng ở bước hỏng đầu tiên rồi im: báo cáo trả về TOÀN BỘ trạng thái
 * từng bước. Một nút chỉ nói "thất bại" buộc người bấm phải đoán nó đã kịp làm
 * gì, và đoán sai ở đây nghĩa là chạy lại một bước đã xong.
 */
export async function provisionSiteAction(
  _prev: ProvisionActionResult,
  formData: FormData
): Promise<ProvisionActionResult> {
  const empty = { steps: [], manual: [] };
  const domainName = String(formData.get("domainName") ?? "").trim().toLowerCase();
  const confirm = String(formData.get("confirm") ?? "").trim().toLowerCase();

  if (confirm !== domainName) {
    return { ok: false, message: `Gõ đúng "${domainName}" để xác nhận.`, ...empty };
  }

  const name = String(formData.get("name") ?? "").trim();
  const vertical = String(formData.get("vertical") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const serverIp = String(formData.get("serverIp") ?? "").trim();

  const missing = [
    !name && "tên site",
    !vertical && "ngành",
    !tagline && "tagline",
    !description && "mô tả",
    !serverIp && "IP máy chủ",
  ].filter(Boolean);
  if (missing.length) {
    // Kiểm ở đây chứ không để bước sau gãy: thiếu tagline hay mô tả thì
    // lib/publisher/site-config.ts coi site là CHƯA dựng được, và lỗi đó sẽ
    // nổ ở tận lệnh hq:sites bên repo publisher.
    return { ok: false, message: `Thiếu: ${missing.join(", ")}.`, ...empty };
  }

  const report = await provisionSite({ domainName, name, vertical, tagline, description, serverIp });
  revalidatePath("/domains");

  const failed = report.steps.filter((s) => s.status === "failed").length;
  const waiting = report.steps.filter((s) => s.status === "waiting").length;
  const done = report.steps.filter((s) => s.status === "done").length;

  return {
    ok: failed === 0,
    message:
      failed > 0
        ? `${done} bước xong, ${failed} bước HỎNG, ${waiting} bước đang chờ.`
        : waiting > 0
          ? `${done} bước xong, ${waiting} bước chờ phần việc tay bên dưới. Làm xong rồi bấm lại.`
          : `${done} bước xong.`,
    steps: report.steps,
    manual: report.manual,
  };
}
