import { prisma } from "@/lib/db/prisma";
import { apiJson } from "@/lib/api/cache-policy";
import { normalizeHost } from "@/lib/publisher/link-domain";
import { prefixOf, hashKey, hashesMatch, judgeScope, type ApiCaller, type ApiScope } from "@/lib/api/publisher-key";

export type { ApiCaller, ApiScope };

/**
 * The phrase deploy/deploy.sh greps for to decide a release is alive.
 *
 * It is pulled out as a constant because a second file depends on it and that
 * file cannot import from here: the deploy health check is bash, and it asserts
 * that an unauthenticated request answers 401 AND that the body is OURS — a
 * bare 401 could come from any process holding port 3000.
 *
 * Reword the sentence below freely; move this phrase and the deploy health
 * check starts failing. That failure is loud (the deploy rolls back and says
 * why) rather than silent, so this is a coupling to KNOW about, not one to
 * engineer around. The comment in deploy.sh points back here.
 */
export const AUTH_FAILURE_ANCHOR = "provide a valid API key";

/** Không ghi lastUsedAt dày hơn mức này. Mốc này để trả lời "khoá còn ai
 * dùng không" — câu hỏi tính bằng ngày — nên ghi mỗi request chỉ đổi một
 * lượt đọc thành một lượt ghi trên đường đi nóng mà không mua thêm gì. */
const LAST_USED_THROTTLE_MS = 10 * 60 * 1000;

function unauthorized() {
  // apiJson, not Response.json: this rejection is returned before any route
  // handler runs, so it would otherwise be the one response in the whole API
  // that carries no cache policy. A cached 401 outlives the rotated key that
  // caused it, and the consumer sees an auth failure it has already fixed.
  return apiJson(
    { error: `Unauthorized — ${AUTH_FAILURE_ANCHOR} via 'Authorization: Bearer <key>' or 'X-Api-Key' header.` },
    { status: 401 }
  );
}

/** Ai đang gọi — hoặc null nếu không khoá nào khớp. Không nói vì sao không
 * khớp: sai khoá, khoá đã thu hồi và khoá không tồn tại phải nhìn giống hệt
 * nhau từ bên ngoài. */
async function callerOf(request: Request): Promise<ApiCaller | null> {
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const candidate = bearerKey ?? request.headers.get("x-api-key");

  const prefix = prefixOf(candidate);
  if (!prefix || !candidate) return null;

  const row = await prisma.publisherApiKey.findUnique({
    where: { keyPrefix: prefix },
    select: {
      id: true,
      keyHash: true,
      revokedAt: true,
      lastUsedAt: true,
      websiteId: true,
      website: { select: { name: true, vertical: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  if (!hashesMatch(hashKey(candidate), row.keyHash)) return null;

  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    // Không await: mốc "dùng lần cuối" trễ vài trăm ms không sai, còn một
    // request bị chậm vì ghi mốc thì sai. Nuốt lỗi vì hỏng ở đây không được
    // phép biến một request đã xác thực thành 500.
    prisma.publisherApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } })
      .catch(() => {});
  }

  return {
    keyId: row.id,
    websiteId: row.websiteId,
    websiteName: row.website?.name ?? null,
    vertical: row.website?.vertical ?? null,
  };
}

/**
 * Every /api/v1 route calls this first. Returns a Response to return
 * immediately, or null if the request is authenticated AND in scope. Accepts
 * either "Authorization: Bearer <key>" or "X-Api-Key: <key>" — plugins for
 * different CMSes vary in which one is easiest to set.
 *
 * `scope` BẮT BUỘC. Trước đây không có tham số này và mọi khoá đọc được mọi
 * niche; kiểu bỏ sót nguy hiểm nhất khi thêm giới hạn là im lặng — một route
 * mới quên giới hạn vẫn chạy, vẫn 200, và phục vụ dữ liệu của publisher khác.
 * Để nó bắt buộc thì quên là lỗi biên dịch, không phải một lỗ hổng.
 */
export async function requireApiKey(request: Request, scope: ApiScope): Promise<Response | null> {
  const caller = await callerOf(request);
  if (!caller) return unauthorized();

  let hostMatches: boolean | undefined;
  if (scope !== "no-scope" && "host" in scope && caller.websiteId) {
    const site = await prisma.website.findUnique({ where: { id: caller.websiteId }, select: { url: true } });
    hostMatches = !!site && normalizeHost(site.url) === normalizeHost(scope.host);
  }

  const verdict = judgeScope(caller, scope, hostMatches);
  if (verdict.ok) return null;

  // 403, không phải 404: khoá này CÓ thật và đã xác thực được, thứ thiếu là
  // quyền. Trả 404 ở đây sẽ gửi người ta đi tìm dữ liệu không tồn tại trong
  // khi vấn đề là dùng nhầm khoá.
  return apiJson({ error: verdict.reason }, { status: 403 });
}

/** Cho route cần biết ai gọi chứ không chỉ cần chặn — ví dụ để lọc danh
 * sách xuống đúng phần của publisher đó. Đã xác thực và đã trong phạm vi. */
export async function apiCaller(request: Request): Promise<ApiCaller | null> {
  return callerOf(request);
}
