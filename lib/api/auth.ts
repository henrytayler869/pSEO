import { verifyApiKey } from "@/lib/settings/api-key";
import { apiJson } from "@/lib/api/cache-policy";

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
    { error: "Unauthorized — provide a valid API key via 'Authorization: Bearer <key>' or 'X-Api-Key' header." },
    { status: 401 }
  );
}
