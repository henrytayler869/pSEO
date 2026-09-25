"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { assertValidGscProperty, listSitemaps, submitSitemap } from "@/lib/google/search-console";
import { setWordPressAdminPassword, generatePassword, MIN_PASSWORD_LENGTH, WpAdminPasswordError } from "@/lib/wordpress/admin-password";
import { assertValidGa4MeasurementId, assertValidGa4PropertyId } from "@/lib/google/analytics-data";
import { notifySiteConfigChanged } from "@/lib/publisher/notify-site";
import { normalizeHost } from "@/lib/publisher/link-domain";
import { getVerticalsWithPages } from "@/lib/queries/verticals";
import { createPublisherKey, revokePublisherKey } from "@/lib/settings/api-key";
import { pushKeyToSite, isHeaderSafeSecret } from "@/lib/publisher/push-key";
import { resolveCourier } from "@/lib/publisher/couriers";
import { judgeReadiness } from "@/lib/publisher/site-config";
import { judgeFillBudget, COST_PER_PASSAGE_USD } from "@/lib/ai/fill-queue";
import { buildFillQueue } from "@/lib/queries/fill-queue";
import { buildClusterFillQueue, COST_PER_CLUSTER_USD } from "@/lib/queries/cluster-fill-queue";
import { generateForCluster } from "@/lib/ai/cluster-generate";
import { getOrGenerateInterpretation } from "@/lib/ai/generate";
import { getSpendUsdForVertical, SpendCapExceededError } from "@/lib/ai/anthropic";
import { createPropertyWithWebStream } from "@/lib/google/analytics-admin";

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
  const knownVerticals = await getVerticalsWithPages();
  if (!knownVerticals.includes(vertical)) {
    return {
      ok: false,
      message: vertical
        ? `Ngành "${vertical}" chưa có trang nào trong hệ thống — không hàng MarketIdentity (trục ZIP) lẫn EntityIdentity (trục không địa lý). Đang có: ${knownVerticals.join(", ")}.`
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

  /**
   * try CHỈ bọc lời ghi. Cùng lỗi đã đo ở refreshDomainAction (PR #97): bọc
   * cả revalidatePath thì một hỏng hóc xảy ra SAU khi hàng đã tạo xong sẽ
   * được báo là "Kết nối thất bại" — trong khi website đã nối rồi. Người đọc
   * thông báo đó sẽ thử lại, và lần thử lại vỡ vì gscPropertyUrl đã unique.
   */
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
        // Bỏ trống thì LƯU TRỐNG. Bản trước điền deriveWpApiBaseUrl(url) —
        // một địa chỉ dựng bằng phép nối chuỗi mà không ai hỏi WordPress có
        // trả lời ở đó không. theaccidentrecord.com nhận đúng giá trị đó, và
        // cả /wp-admin lẫn /wp-json của nó đều 404.
        wpApiBaseUrl: wpApiBaseUrlRaw || null,
      },
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Kết nối thất bại." };
  }

  revalidatePath("/publisher");
  return { ok: true, message: `Đã kết nối "${name}".` };
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
 * Đặt hoặc xoá ngân sách AI của publisher.
 *
 * Ô trống = xoá ngân sách, và đó là một hành động khác hẳn với đặt bằng 0.
 * Trống nghĩa là "không theo dõi"; 0 nghĩa là "không được tiêu thêm". Gộp
 * hai cái vào một giá trị sẽ làm người đặt 0 thấy giao diện báo "chưa đặt
 * ngân sách" và nghĩ mình bấm hụt.
 */
export async function updateAiBudgetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  const raw = String(formData.get("aiBudgetUsd") ?? "").trim();
  if (!websiteId) return { ok: false, message: "Thiếu websiteId." };

  let value: number | null = null;
  if (raw !== "") {
    // Không dùng Number() trần: Number("") là 0 và Number("12 đô") là NaN.
    // Cả hai đều lặng lẽ lưu một con số không phải thứ người ta gõ.
    const parsed = Number(raw.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(parsed)) return { ok: false, message: `"${raw}" không phải số tiền.` };
    if (parsed < 0) return { ok: false, message: "Ngân sách không âm được." };
    value = parsed;
  }

  try {
    await prisma.website.update({ where: { id: websiteId }, data: { aiBudgetUsd: value } });
    revalidatePath(`/publisher/${websiteId}`);
    revalidatePath("/publisher");
    return {
      ok: true,
      message: value === null ? "Đã xoá ngân sách — không theo dõi nữa." : `Đã đặt ngân sách $${value.toFixed(2)}.`,
    };
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

  // Chặn ở ô nhập, không để nổ ở lúc đẩy. Secret này đi vào header HTTP, mà
  // header chỉ mang được ASCII — `new Request()` ném TypeError với thông báo
  // ("character at index 4 has a value of 7853") không chỉ về đâu cả, và nó
  // nổ cách xa ô đã sinh ra nó.
  if (raw && !isHeaderSafeSecret(raw)) {
    return {
      ok: false,
      message:
        "Secret chỉ được dùng chữ/số/dấu câu ASCII, không dấu tiếng Việt và không khoảng trắng — nó phải đặt vừa vào một header HTTP.",
    };
  }

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

    // Nộp sitemap qua Search Console cần property. Nói thẳng khi thiếu, thay
    // vì ném một lỗi Google khó đọc từ sâu trong stack.
    if (!website.gscPropertyUrl) {
      return { ok: false, message: "Site này chưa cấu hình Search Console property — không nộp sitemap được." };
    }
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

export interface CreateKeyResult {
  ok: boolean;
  message: string;
  /** Giá trị đầy đủ, chỉ có trong ĐÚNG phản hồi này. Không endpoint nào đọc
   * lại được — HQ chỉ lưu băm. */
  key?: string;
  /** Site đã nhận và XÁC NHẬN ghi. Nếu false thì khoá bên dưới phải được đặt
   * thủ công, và UI phải nói vậy thay vì hiện một dòng thành công. */
  pushed?: boolean;
}

/**
 * Đẩy khoá QUA một site khác, khi site đích chưa trả lời được.
 *
 * Ca dùng thật: site mới chưa phân giải DNS, nên vừa không nhận được khoá vừa
 * chưa có revalidate secret của riêng nó — mà thiếu khoá thì build đỏ, và build
 * phải xanh trước khi có gì để trỏ DNS vào. `lib/publisher/couriers.ts` giải
 * thích vì sao đường này tới đúng chỗ và vì sao nó không mở rộng bán kính.
 *
 * Phải CHỌN, không tự rơi vào. Nếu đẩy thẳng hụt thì action trả về thất bại
 * kèm lý do, chứ không âm thầm thử lại qua host khác: một đường vận chuyển bí
 * mật tự đổi đích khi gặp lỗi là thứ không ai truy được về sau.
 */

export async function createPublisherKeyAction(_prev: CreateKeyResult, formData: FormData): Promise<CreateKeyResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const label = String(formData.get("label") ?? "");
  if (!websiteId) return { ok: false, message: "Thiếu website." };

  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { vertical: true, url: true, revalidateSecret: true },
  });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  // Giải quyết đường đi TRƯỚC khi sinh khoá. HQ chỉ lưu băm, nên một khoá đã
  // tạo mà không tới được site là khoá không ai cầm — nó nằm trong bảng trông
  // y như khoá còn sống. Kiểm điều biết trước được (site trung chuyển có tồn
  // tại, có secret dùng được) trước khi có gì phải thu hồi.
  const viaId = String(formData.get("via") ?? "");
  let via: { url: string; revalidateSecret: string; name: string } | undefined;
  if (viaId) {
    const resolved = await resolveCourier(viaId, websiteId);
    if ("error" in resolved) return { ok: false, message: resolved.error };
    via = resolved;
  }

  const { key } = await createPublisherKey(websiteId, label);

  // Đẩy luôn, không để thành một nút thứ hai. Một khoá đã tạo mà chưa đẩy là
  // một hàng trong bảng không tương ứng với gì cả — và nút "đẩy" riêng là nút
  // người ta sẽ quên bấm, rồi kết luận tính năng hỏng.
  const push = await pushKeyToSite(site, key, via);

  revalidatePath(`/publisher/${websiteId}`);
  return {
    ok: true,
    message: push.ok
      ? `${push.detail} Site đang dùng khoá mới ngay, không cần sửa .env hay restart. Khoá chỉ đọc được niche "${site.vertical}".`
      : `Đã tạo khoá (chỉ đọc được niche "${site.vertical}") nhưng CHƯA đẩy sang site được: ${push.detail} Copy khoá bên dưới và đặt thủ công vào HQ_API_KEY, hoặc sửa nguyên nhân rồi tạo khoá khác.`,
    key,
    pushed: push.ok,
  };
}

export async function revokePublisherKeyAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("keyId") ?? "");
  const websiteId = String(formData.get("websiteId") ?? "");
  if (!id) return { ok: false, message: "Thiếu khoá." };
  await revokePublisherKey(id);
  if (websiteId) revalidatePath(`/publisher/${websiteId}`);
  return { ok: true, message: "Đã thu hồi. Nơi nào còn dùng khoá này sẽ nhận 401 ngay lập tức." };
}

/**
 * Danh tính hiển thị của site: tên, tagline, description.
 *
 * Tách khỏi connectWebsiteAction vì hai việc xảy ra ở hai thời điểm: site
 * được đăng ký ngay khi có domain, còn câu chữ thương hiệu thường chốt sau.
 * Bắt điền đủ ở form kết nối sẽ đẩy người ta tới chỗ gõ bừa cho qua — và một
 * description gõ bừa là thứ đi thẳng vào kết quả tìm kiếm.
 *
 * Ô trống XOÁ giá trị, không bị từ chối. Gỡ một description sai là việc có
 * thật, và một ô chỉ điền được mà không xoá được sẽ nhốt giá trị sai ở đó.
 */
export async function updateSiteIdentityAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  if (!websiteId) return { ok: false, message: "Thiếu websiteId." };

  const name = String(formData.get("name") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { ok: false, message: "Tên site không được để trống — nó là tiêu đề trang và tên thương hiệu." };

  try {
    const website = await prisma.website.update({
      where: { id: websiteId },
      data: { name, tagline: tagline || null, description: description || null },
    });
    revalidatePath(`/publisher/${websiteId}`);
    revalidatePath("/publisher");

    // Báo ngay cho site, cùng lý do như measurement ID: site tự lấy khi cache
    // hết hạn, nhưng HTML nằm ở Cloudflare tới 24 giờ và người vừa sửa tên sẽ
    // mở trang, không thấy gì đổi, rồi kết luận là hỏng.
    const notify = await notifySiteConfigChanged(website);
    const { ready, missing } = judgeReadiness({
      id: website.id,
      name: website.name,
      url: website.url,
      vertical: website.vertical,
      tagline: website.tagline,
      description: website.description,
      ga4MeasurementId: website.ga4MeasurementId,
      wpApiBaseUrl: website.wpApiBaseUrl,
    });

    const state = ready
      ? "Site đã đủ danh tính để dựng."
      : `CHƯA đủ để dựng — còn thiếu: ${missing.map((m) => `${m.field} (${m.why})`).join("; ")}.`;
    return { ok: true, message: `Đã lưu. ${state} ${notify.detail}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Lưu thất bại." };
  }
}

export interface FillBatchResult {
  ok: boolean;
  message: string;
  /** Đã sinh đạt trong lô này. */
  filled?: number;
  /** Bị validator chặn — cơ chế hoạt động ĐÚNG, không phải lỗi. */
  rejected?: number;
  /** Lỗi kỹ thuật. Khác hẳn `rejected`, và gộp hai cái sẽ giấu mất sự cố. */
  failed?: number;
  /** Còn lại chưa phục vụ được, để UI biết có nên gọi lô tiếp không. */
  remaining?: number;
  costUsd?: number;
}

/**
 * Điền MỘT LÔ, không phải tất cả.
 *
 * "Fill all" ở giao diện là lời gọi lặp lại hàm này cho tới khi `remaining`
 * về 0. Không dựng hàng đợi job, và đó là lựa chọn có lý do: repo này chưa có
 * hạ tầng job nào, và thêm một cái cho việc này là thêm một hệ phải vận hành.
 * Lô nhỏ cho ba thứ mà một job dài không cho: tiến độ nhìn thấy được, dừng
 * được giữa chừng, và mỗi lô là một lần kiểm ngân sách mới.
 *
 * Mỗi lô tự hỏi lại đường phục vụ, nên hai người bấm cùng lúc không sinh
 * trùng: người thứ hai thấy ZIP kia đã phục vụ được và bỏ qua.
 */
export async function fillContentBatchAction(_prev: FillBatchResult, formData: FormData): Promise<FillBatchResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const size = Math.min(Math.max(Number(formData.get("size") ?? 5), 1), 25);
  if (!websiteId) return { ok: false, message: "Thiếu website." };

  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { vertical: true, url: true, aiBudgetUsd: true },
  });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  const queue = await buildFillQueue(site);
  // "Không dựng được hàng đợi" KHÔNG được báo thành "không còn gì để điền":
  // cả hai cho pending rỗng, và một cái nghĩa là xong việc còn cái kia nghĩa
  // là có thứ đang hỏng.
  if (queue.unavailable) return { ok: false, message: queue.unavailable };
  if (queue.pending.length === 0) {
    return { ok: true, message: "Không còn gì để điền.", filled: 0, rejected: 0, failed: 0, remaining: 0, costUsd: 0 };
  }

  // Kiểm ngân sách cho ĐÚNG LÔ NÀY, không phải cho toàn bộ hàng đợi. Chặn cả
  // lô vì tổng vượt trần sẽ khoá luôn việc điền mười trang quan trọng nhất.
  // Chi tiêu CỦA NGHỀ NÀY, để cùng đơn vị đo với ngân sách của site.
  const spent = await getSpendUsdForVertical(site.vertical);
  const verdict = judgeFillBudget({
    budgetUsd: site.aiBudgetUsd,
    spentUsd: spent,
    estimatedUsd: Math.min(size, queue.pending.length) * COST_PER_PASSAGE_USD,
  });
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  let filled = 0;
  let rejected = 0;
  let failed = 0;
  let costUsd = 0;

  for (const candidate of queue.pending.slice(0, size)) {
    try {
      const out = await getOrGenerateInterpretation(site.vertical, candidate.zip);
      if (!out) {
        failed++;
        continue;
      }
      costUsd += out.costUsd;
      if (out.validation.passed) filled++;
      else rejected++;
    } catch {
      failed++;
    }
  }

  revalidatePath(`/publisher/${websiteId}/content`);
  const remaining = queue.pending.length - filled;
  const parts = [`điền ${filled}`];
  if (rejected > 0) parts.push(`${rejected} bị validator chặn`);
  if (failed > 0) parts.push(`${failed} LỖI KỸ THUẬT`);
  return {
    ok: failed === 0,
    message: `${parts.join(", ")} — $${costUsd.toFixed(4)}. Còn ${remaining}.`,
    filled,
    rejected,
    failed,
    remaining,
    costUsd: Number(costUsd.toFixed(4)),
  };
}

/**
 * Điền MỘT LÔ đoạn cấp CỤM.
 *
 * Song song với fillContentBatchAction chứ không gộp vào nó: hai thứ này có
 * đơn giá khác nhau ($0,0619 so với $0,0237), luật kiểm khác nhau, và dừng
 * được riêng. Gộp một nút sẽ khiến người bấm không biết lô mình vừa gọi tiêu
 * gấp ba lần lô trước.
 *
 * Chi phí gắn ĐÍCH DANH website: thành viên cụm lấy từ /api/inventory của
 * chính site đó, nên hai publisher cùng niche có cụm khác nhau và cần đoạn
 * khác nhau — khác hẳn đoạn theo ZIP vốn cache theo niche và phục vụ mọi site.
 */
export async function fillClusterBatchAction(
  _prev: FillBatchResult,
  formData: FormData
): Promise<FillBatchResult> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const size = Math.min(Math.max(Number(formData.get("size") ?? 3), 1), 15);
  if (!websiteId) return { ok: false, message: "Thiếu website." };

  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { vertical: true, url: true, aiBudgetUsd: true },
  });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  const queue = await buildClusterFillQueue(site);
  if (queue.unavailable) return { ok: false, message: queue.unavailable };
  if (queue.pending.length === 0) {
    return { ok: true, message: "Mọi trang cụm đã có chữ.", filled: 0, rejected: 0, failed: 0, remaining: 0, costUsd: 0 };
  }

  const spent = await getSpendUsdForVertical(site.vertical);
  const verdict = judgeFillBudget({
    budgetUsd: site.aiBudgetUsd,
    spentUsd: spent,
    estimatedUsd: Math.min(size, queue.pending.length) * COST_PER_CLUSTER_USD,
  });
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  let filled = 0;
  let rejected = 0;
  let failed = 0;
  let costUsd = 0;

  for (const c of queue.pending.slice(0, size)) {
    try {
      const out = await generateForCluster(site.vertical, c.zips, c.path, websiteId);
      // null nghĩa là dưới 2 ZIP có dữ liệu — một ZIP không tạo thành dải, nên
      // không có gì để so sánh và cũng không có gì để viết. Không phải lỗi, và
      // cũng không phải validator chặn.
      if (!out) {
        failed++;
        continue;
      }
      costUsd += out.costUsd;
      if (out.passed) filled++;
      else rejected++;
    } catch (err) {
      // Chạm trần chi tiêu toàn hệ dừng cả lô, và nói ra — chứ không đếm
      // thành "lỗi kỹ thuật" rồi để người bấm đi tìm một sự cố không có.
      if (err instanceof SpendCapExceededError) {
        revalidatePath(`/publisher/${websiteId}/content`);
        return {
          ok: false,
          message: `Chạm trần chi tiêu toàn hệ sau ${filled} cụm — $${costUsd.toFixed(4)}. Cụm chưa sinh giữ nguyên.`,
          filled,
          rejected,
          failed,
          remaining: queue.pending.length - filled,
          costUsd: Number(costUsd.toFixed(4)),
        };
      }
      failed++;
    }
  }

  revalidatePath(`/publisher/${websiteId}/content`);
  const remaining = queue.pending.length - filled;
  const parts = [`điền ${filled} cụm`];
  if (rejected > 0) parts.push(`${rejected} bị validator chặn`);
  if (failed > 0) parts.push(`${failed} LỖI KỸ THUẬT`);
  return {
    ok: failed === 0,
    message: `${parts.join(", ")} — $${costUsd.toFixed(4)}. Còn ${remaining}.`,
    filled,
    rejected,
    failed,
    remaining,
    costUsd: Number(costUsd.toFixed(4)),
  };
}

export interface AdminPasswordResult {
  ok: boolean;
  message: string;
  /**
   * Mật khẩu mới, CHỈ trả về ngay sau khi đặt thành công và KHÔNG lưu ở đâu.
   *
   * Đây là bản sao duy nhất tồn tại ngoài hash của WordPress, và nó sống đúng
   * một lần render. Lưu nó lại để "xem sau" biến CSDL này thành nơi một lần rò
   * rỉ mở được mọi wp-admin — chính điều mà việc chỉ lưu hash tránh được.
   */
  password?: string;
}

/**
 * Đặt mật khẩu mới cho tài khoản quản trị WordPress của một publisher.
 *
 * KHÔNG có action đọc mật khẩu hiện tại, và sẽ không có: WordPress lưu hash,
 * không nơi nào giữ bản rõ. "Đổi rồi hiện một lần" giải đúng nhu cầu vào được
 * wp-admin mà không tạo ra kho mật khẩu.
 */
export async function setAdminPasswordAction(
  _prev: AdminPasswordResult,
  formData: FormData
): Promise<AdminPasswordResult> {
  const websiteId = String(formData.get("websiteId") ?? "").trim();
  const typed = String(formData.get("password") ?? "");
  if (!websiteId) return { ok: false, message: "Thiếu website." };

  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { url: true, wpApiBaseUrl: true, wpUsername: true, wpLoopbackSecret: true },
  });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  if (!site.wpApiBaseUrl) {
    return {
      ok: false,
      message: 'Site này chưa nối WordPress — ô "WordPress REST API" đang trống.',
    };
  }
  if (!site.wpUsername) {
    return {
      ok: false,
      message: 'Chưa biết tên tài khoản quản trị. Điền ô "WordPress username" trước.',
    };
  }

  // Bỏ trống = sinh máy. Đó là đường mặc định vì mật khẩu người gõ ở một ô
  // trên trang web đi qua nhiều tầng hơn một mật khẩu sinh ra rồi hiện một lần.
  const password = typed.trim() || generatePassword();
  if (typed.trim() && typed.trim().length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Mật khẩu phải dài ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` };
  }

  try {
    await setWordPressAdminPassword({
      wpApiBaseUrl: site.wpApiBaseUrl,
      username: site.wpUsername,
      password,
      loopbackSecret: site.wpLoopbackSecret,
    });
  } catch (err) {
    if (err instanceof WpAdminPasswordError) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error ? err.message : "Đổi mật khẩu thất bại." };
  }

  revalidatePath(`/publisher/${websiteId}`);
  return {
    ok: true,
    message:
      `Đã đổi mật khẩu cho "${site.wpUsername}". Mọi phiên đăng nhập của tài khoản này đã bị huỷ. ` +
      `Mật khẩu hiện MỘT LẦN dưới đây và không lưu ở đâu — chép ngay.`,
    // Chỉ trả khi người dùng KHÔNG tự gõ: họ đã có mật khẩu mình vừa gõ, và
    // in lại nó chỉ thêm một bản sao vào chỗ khác.
    password: typed.trim() ? undefined : password,
  };
}

export interface CreateGa4Result {
  ok: boolean;
  message: string;
  propertyId?: string;
  measurementId?: string;
}

/**
 * Tạo GA4 property + luồng web cho một website đã nối, rồi LƯU cả hai id.
 *
 * Lưu luôn thay vì hiện ra cho người chép: chép tay giữa hai ô là chỗ
 * ga4PropertyId và ga4MeasurementId bị đảo cho nhau, và hai cái đó đảo nhau
 * thì Data API từ chối một bên còn bên kia thu thập rỗng trong khi mọi trang
 * vẫn render — không màn hình nào báo.
 */
export async function createGa4PropertyAction(_prev: CreateGa4Result, formData: FormData): Promise<CreateGa4Result> {
  const websiteId = String(formData.get("websiteId") ?? "");
  const accountName = String(formData.get("accountName") ?? "").trim();
  if (!websiteId) return { ok: false, message: "Thiếu website." };
  if (!accountName) return { ok: false, message: "Chưa chọn tài khoản Google Analytics." };

  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { name: true, url: true, ga4PropertyId: true },
  });
  if (!site) return { ok: false, message: "Không tìm thấy website." };

  try {
    const created = await createPropertyWithWebStream({
      accountName,
      displayName: site.name,
      siteUrl: site.url,
    });

    await prisma.website.update({
      where: { id: websiteId },
      data: { ga4PropertyId: created.propertyId, ga4MeasurementId: created.measurementId },
    });
    revalidatePath(`/publisher/${websiteId}`);

    return {
      ok: true,
      message:
        `Đã tạo property "${created.displayName}" và lưu cả hai id. ` +
        `Property ID ${created.propertyId} để ĐỌC báo cáo; Measurement ID ${created.measurementId} để site GHI sự kiện.`,
      propertyId: created.propertyId,
      measurementId: created.measurementId,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Tạo GA4 property thất bại." };
  }
}
