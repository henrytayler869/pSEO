import { verifyApiKey } from "@/lib/settings/api-key";

/** Every /api/v1 route calls this first. Returns a 401 Response to return
 * immediately, or null if the request is authenticated. Accepts either
 * "Authorization: Bearer <key>" or "X-Api-Key: <key>" — plugins for
 * different CMSes vary in which one is easiest to set. */
export async function requireApiKey(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const candidate = bearerKey ?? request.headers.get("x-api-key");

  if (await verifyApiKey(candidate)) return null;

  return Response.json(
    { error: "Unauthorized — provide a valid API key via 'Authorization: Bearer <key>' or 'X-Api-Key' header." },
    { status: 401 }
  );
}
