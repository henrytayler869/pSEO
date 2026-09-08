export interface NotifyResult {
  attempted: boolean;
  ok: boolean;
  /** Human-readable outcome, meant to be shown next to the save button. */
  detail: string;
}

/**
 * Tells a site that a setting it reads from Head Quarter has changed.
 *
 * The site pulls its configuration, which is what makes central management work
 * at all — but a pull is only as fresh as the cache in front of it, and this
 * site's HTML sits on Cloudflare for 24 hours. Someone would type a measurement
 * ID, open the site, find no tag, and conclude the feature is broken. It would
 * not be broken; it would be a day early.
 *
 * So the save pushes as well as the site pulling. The push is the fast path and
 * the cache expiry is the backstop, never the other way round.
 *
 * Failure here is REPORTED, not thrown. The value is already saved and the site
 * will pick it up on its own eventually; losing the save because a notification
 * failed would be the worse outcome. But it is not swallowed either — a silent
 * failed push is indistinguishable from a successful one, and the difference is
 * a day of missing analytics.
 */
export async function notifySiteConfigChanged(website: {
  url: string;
  revalidateSecret: string | null;
}): Promise<NotifyResult> {
  // Truthiness, not a null check: undefined (stale client, partial select) and
  // "" are both "no usable secret", and treating either as configured would
  // send a request guaranteed to 401.
  if (!website.revalidateSecret) {
    return {
      attempted: false,
      ok: false,
      detail:
        "Chưa có revalidate secret cho site này nên không báo ngay được — site sẽ tự lấy giá trị mới khi cache hết hạn (có thể tới 24 giờ vì HTML nằm ở Cloudflare).",
    };
  }

  const endpoint = `${website.url.replace(/\/+$/, "")}/api/revalidate`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "x-revalidate-secret": website.revalidateSecret, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "site-config" }),
    });
    if (response.status === 200) {
      return { attempted: true, ok: true, detail: "Đã báo cho site, mã mới có hiệu lực ngay." };
    }
    const body = (await response.text()).slice(0, 120);
    // The status is named because these need completely different fixes: a
    // wrong secret is a settings problem, a 404 means the site is running a
    // build that predates this endpoint and needs deploying.
    const cause =
      response.status === 401
        ? "Secret không khớp với REVALIDATE_SECRET trên site."
        : response.status === 404
          ? "Site đang chạy bản build chưa hỗ trợ loại 'site-config' — cần deploy lại site."
          : body;
    return {
      attempted: true,
      ok: false,
      detail: `Site trả HTTP ${response.status} khi được báo (${endpoint}). ${cause} Giá trị vẫn đã lưu; site sẽ tự lấy khi cache hết hạn.`,
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      detail: `Không gọi được ${endpoint}: ${err instanceof Error ? err.message : String(err)}. Giá trị vẫn đã lưu.`,
    };
  }
}
