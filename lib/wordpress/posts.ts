/**
 * Reading and writing WordPress posts from Head Quarter.
 *
 * Reading needs nothing — WP's REST API serves published content
 * unauthenticated, which is why `fetchPublishedPostCount` has worked all
 * along. WRITING needs an Application Password, and that is the whole reason
 * this file exists separately: the two halves fail for different reasons and
 * a caller must be able to tell them apart.
 *
 * Application Password, not the account password. WordPress issues them per
 * application, they can be revoked one at a time without changing the login,
 * and they are the credential WP itself documents for REST writes. Head
 * Quarter never sees the account password.
 */

export interface WpPost {
  id: number;
  slug: string;
  status: string;
  title: string;
  /** Raw content — what the editor holds, not the rendered HTML. Editing
   * `rendered` and writing it back would bake in whatever filters ran on the
   * way out, so the edit form must never be given the rendered form. */
  content: string;
  link: string;
  modifiedAt: string;
}

export interface WpCredentials {
  username: string;
  applicationPassword: string;
  /**
   * Shared secret the publisher's must-use plugin checks before re-enabling
   * Application Passwords, which WordPress disables on non-SSL connections.
   *
   * Sent on every request, read from nothing. That is the point: three
   * attempts to identify this caller from properties of the request all failed,
   * and the measurement that killed the last one is worth keeping close —
   * mod_remoteip CONSUMES X-Forwarded-For, so PHP cannot see whether the header
   * was sent, and "loopback with no XFF" and "loopback with a forged XFF" are
   * indistinguishable to the plugin.
   *
   * Measured in the real WordPress context 2026-09-10 (an earlier probe that
   * did not load wp-config.php reported the opposite for is_ssl and would have
   * sent us the wrong way):
   *
   *              loopback        subdomain       loopback + forged XFF
   *   XFF        absent          present         absent  <- consumed
   *   REMOTE_ADDR 172.19.0.1     172.71.15.132   203.0.113.9  <- forged value
   *   is_ssl()   false           true            false
   *
   * Null when the publisher has no such plugin. Writes then fail with 401,
   * which is the visible direction.
   */
  loopbackSecret?: string | null;
}

export class WordPressError extends Error {
  constructor(
    message: string,
    /** True when the cause is a missing or rejected credential rather than
     * anything about the post. The UI says different things for the two, and
     * conflating them sends someone to rewrite a title when the real problem
     * is a revoked password. */
    readonly isAuthProblem: boolean = false
  ) {
    super(message);
    this.name = "WordPressError";
  }
}

function authHeader(creds: WpCredentials): string {
  // Application passwords arrive from WordPress with spaces in them
  // ("abcd EFGH ijkl ..."). WP accepts them either way, but a user pasting one
  // WITH spaces into a field that keeps them, next to one WITHOUT, would get
  // two different-looking credentials that are the same secret — so they are
  // normalised in one place rather than at every call site.
  const password = creds.applicationPassword.replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${creds.username}:${password}`).toString("base64")}`;
}

async function callWp(
  base: string,
  path: string,
  creds: WpCredentials | null,
  init: { method: string; body?: unknown } = { method: "GET" }
): Promise<{ status: number; headers: Headers; json: unknown }> {
  const response = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      ...(creds ? { Authorization: authHeader(creds) } : {}),
      // Only when there is one. Sending an empty header would be a value the
      // plugin compares against and rejects, which reads downstream as a wrong
      // secret rather than as no secret configured.
      ...(creds?.loopbackSecret ? { "X-Atms-Loopback": creds.loopbackSecret } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body from WP is almost always an HTML error page from
    // something in FRONT of WordPress — a proxy, a WAF, a login wall. Saying
    // "invalid JSON" would send someone to read WP's logs, which will be
    // empty because the request never arrived.
    throw new WordPressError(
      `WordPress trả về phản hồi không phải JSON (HTTP ${response.status}). ` +
        `Thường là thứ đứng TRƯỚC WordPress trả lời — proxy, tường lửa, hoặc trang đăng nhập — ` +
        `chứ không phải WordPress. Trích: ${text.slice(0, 160)}`
    );
  }

  if (response.status === 401 || response.status === 403) {
    const code = (json as { code?: string } | null)?.code ?? "";
    throw new WordPressError(
      creds
        ? `WordPress từ chối thông tin đăng nhập (HTTP ${response.status}${code ? `, ${code}` : ""}). ` +
          `Application Password có thể đã bị thu hồi, hoặc tài khoản không đủ quyền sửa bài.`
        : `Thao tác này cần đăng nhập nhưng website chưa lưu Application Password.`,
      true
    );
  }

  return { status: response.status, headers: response.headers, json };
}

function toPost(raw: unknown): WpPost {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = (r.title ?? {}) as Record<string, unknown>;
  const content = (r.content ?? {}) as Record<string, unknown>;
  return {
    id: Number(r.id ?? 0),
    slug: String(r.slug ?? ""),
    status: String(r.status ?? ""),
    title: String(title.raw ?? title.rendered ?? ""),
    content: String(content.raw ?? content.rendered ?? ""),
    link: String(r.link ?? ""),
    modifiedAt: String(r.modified_gmt ?? r.modified ?? ""),
  };
}

/**
 * Lists posts INCLUDING drafts and trash when credentials are present.
 *
 * `status=any` requires authentication — without it WP silently returns only
 * published posts. That silence is the failure mode worth naming: a panel
 * showing "3 posts" when there are 3 published and 2 drafts looks correct and
 * is not, and nobody goes looking for the two that were never mentioned.
 */
export async function listPosts(
  base: string,
  creds: WpCredentials | null,
  limit = 50
): Promise<{ posts: WpPost[]; sawAllStatuses: boolean }> {
  const status = creds ? "any" : "publish";
  const { status: code, json } = await callWp(base, `/posts?per_page=${limit}&context=edit&status=${status}`, creds);

  if (code !== 200) {
    // context=edit also requires auth. Falling back to the public view is
    // better than an error page — a read-only list is still useful — but the
    // caller is told, so the UI can say WHY the list may be incomplete.
    if (creds === null || code === 400) {
      const pub = await callWp(base, `/posts?per_page=${limit}&status=publish`, null);
      if (pub.status !== 200) throw new WordPressError(`WordPress trả HTTP ${pub.status} khi liệt kê bài.`);
      return { posts: (pub.json as unknown[]).map(toPost), sawAllStatuses: false };
    }
    throw new WordPressError(`WordPress trả HTTP ${code} khi liệt kê bài.`);
  }

  return { posts: (json as unknown[]).map(toPost), sawAllStatuses: creds !== null };
}

export async function createPost(
  base: string,
  creds: WpCredentials,
  input: { title: string; content: string; status: "draft" | "publish" }
): Promise<WpPost> {
  const { status, json } = await callWp(base, "/posts", creds, { method: "POST", body: input });
  if (status !== 201) {
    throw new WordPressError(`WordPress từ chối tạo bài (HTTP ${status}): ${describe(json)}`);
  }
  return toPost(json);
}

export async function updatePost(
  base: string,
  creds: WpCredentials,
  id: number,
  input: { title?: string; content?: string; status?: "draft" | "publish" }
): Promise<WpPost> {
  const { status, json } = await callWp(base, `/posts/${id}`, creds, { method: "POST", body: input });
  if (status !== 200) {
    throw new WordPressError(`WordPress từ chối sửa bài ${id} (HTTP ${status}): ${describe(json)}`);
  }
  return toPost(json);
}

/**
 * Moves a post to the TRASH. Not a permanent delete, and deliberately not
 * offering one.
 *
 * WordPress's DELETE removes to trash unless `force=true` is passed, and this
 * function never passes it. Restoring from trash is a click in wp-admin;
 * restoring from a forced delete is restoring a database backup. A panel that
 * can do the second one from a table row is a panel where one misclick costs
 * a post permanently, and nothing here needs that.
 */
export async function trashPost(base: string, creds: WpCredentials, id: number): Promise<void> {
  const { status, json } = await callWp(base, `/posts/${id}`, creds, { method: "DELETE" });
  if (status !== 200) {
    throw new WordPressError(`WordPress từ chối chuyển bài ${id} vào thùng rác (HTTP ${status}): ${describe(json)}`);
  }
}

function describe(json: unknown): string {
  const r = (json ?? {}) as { message?: string; code?: string };
  return r.message ?? r.code ?? "không có thông báo";
}
