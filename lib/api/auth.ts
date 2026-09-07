import { verifyApiKey } from "@/lib/settings/api-key";
import { apiJson } from "@/lib/api/cache-policy";

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

/** Every /api/v1 route calls this first. Returns a 401 Response to return
 * immediately, or null if the request is authenticated. Accepts either
 * "Authorization: Bearer <key>" or "X-Api-Key: <key>" — plugins for
 * different CMSes vary in which one is easiest to set. */
export async function requireApiKey(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const candidate = bearerKey ?? request.headers.get("x-api-key");

  if (await verifyApiKey(candidate)) return null;

  // apiJson, not Response.json: this rejection is returned before any route
  // handler runs, so it would otherwise be the one response in the whole API
  // that carries no cache policy. A cached 401 outlives the rotated key that
  // caused it, and the consumer sees an auth failure it has already fixed.
  return apiJson(
    {
      error: `Unauthorized — ${AUTH_FAILURE_ANCHOR} via 'Authorization: Bearer <key>' or 'X-Api-Key' header.`,
    },
    { status: 401 }
  );
}
