import { fetchWithCurlFallback } from "@/lib/net/curl-fetch";

const CLOUDFLARE_BASE_URL = "https://api.cloudflare.com/client/v4";

export interface CloudflareZone {
  id: string;
  status: string; // "initializing" | "pending" | "active" | "moved" — stored verbatim, not re-typed as an enum
  nameServers: string[];
}

export class CloudflareApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

/**
 * Cloudflare API v4 — zones (create / get). Shapes confirmed live against
 * Cloudflare's own current API reference
 * (developers.cloudflare.com/api/resources/zones/methods/{create,get}/) on
 * 2026-09-06 — not yet exercised against a real account (no
 * CLOUDFLARE_API_TOKEN configured in this environment), same "built from
 * real docs, unverified against a live call" status as this app's original
 * PVWatts/NOAA/EIA adapters until a real credential exists.
 *
 * Every response — success or failure — is
 * `{ success, result, errors, messages }`; `success: false` is a normal,
 * well-formed response (e.g. "zone already exists", "domain not eligible"),
 * not a network/schema failure, so it's surfaced as a CloudflareApiError
 * with Cloudflare's own message rather than treated as drift.
 */
export async function createCloudflareZone(
  domainName: string,
  apiToken: string,
  accountId: string
): Promise<CloudflareZone> {
  // POST needs a request body, which fetchWithCurlFallback doesn't support
  // (it's a GET-only helper built for the read-only collector adapters) —
  // goes through native fetch directly here instead.
  const response = await fetch(`${CLOUDFLARE_BASE_URL}/zones`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: domainName, account: { id: accountId }, type: "full" }),
  });
  const envelope = parseCloudflareBody(response.status, await response.text());
  return toZone(envelope);
}

/**
 * Finds a zone the account ALREADY has, by name.
 *
 * Needed because "add this domain" and "create this zone" are not the same
 * request. A domain bought and pointed at Cloudflare months ago is already a
 * zone; asking Cloudflare to create it again is refused, correctly, and the
 * refusal is not a problem to report — it is the answer to a question nobody
 * meant to ask.
 *
 * Returns null when there is no such zone, which is different from an error.
 * A caller that conflated the two would report "Cloudflare từ chối" for a
 * domain that simply has not been added yet.
 *
 * Filtered server-side with ?name= rather than listing everything and
 * searching here: an account with hundreds of zones would paginate, and a
 * search over page one only would report "không có" for a zone sitting on
 * page two.
 */
export async function findCloudflareZoneByName(
  domainName: string,
  apiToken: string
): Promise<CloudflareZone | null> {
  const url = `${CLOUDFLARE_BASE_URL}/zones?name=${encodeURIComponent(domainName)}`;
  const { status, body } = await fetchWithCurlFallback(url, { Authorization: `Bearer ${apiToken}` });
  return parseZoneListResponse(status, body.toString("utf-8"), domainName);
}

/**
 * Reads a zone-LIST response. Separate from the single-zone parser on purpose.
 *
 * The list endpoint returns an ARRAY in `result`, while create and get return
 * an object. Feeding a list response to the single-zone parser throws "schema
 * drift" on a perfectly normal empty result — a message that would send
 * someone looking for a Cloudflare API change that never happened.
 *
 * An empty array is a real answer: this account has no zone by that name.
 * Distinct from an error, and callers must not flatten the two.
 */
export function parseZoneListResponse(
  httpStatus: number,
  text: string,
  domainName: string
): CloudflareZone | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CloudflareApiError(
      `Cloudflare trả về phản hồi không phải JSON (HTTP ${httpStatus}): ${text.slice(0, 300)}`
    );
  }
  const envelope = (parsed ?? {}) as { success?: unknown; result?: unknown; errors?: unknown };
  if (typeof envelope.success !== "boolean") {
    throw new CloudflareApiError(
      `Phản hồi Cloudflare thiếu trường "success" — có thể API đã thay đổi cấu trúc (schema drift). HTTP ${httpStatus}.`
    );
  }
  if (!envelope.success) {
    const message = Array.isArray(envelope.errors)
      ? envelope.errors.map((e) => (e as { message?: string }).message ?? JSON.stringify(e)).join("; ")
      : `HTTP ${httpStatus}`;
    throw new CloudflareApiError(`Cloudflare từ chối yêu cầu tra zone: ${message}`);
  }
  if (!Array.isArray(envelope.result)) {
    throw new CloudflareApiError('Phản hồi tra zone của Cloudflare có "result" không phải mảng (schema drift).');
  }

  // Matched exactly, not by prefix. ?name= is a filter, and a filter that ever
  // widens (or a proxy that ignores it) must not make this adopt a different
  // domain's zone — the consequence would be a row pointing at someone else's
  // DNS.
  const match = envelope.result.find((z) => (z as { name?: unknown }).name === domainName) as
    | Record<string, unknown>
    | undefined;
  if (!match) return null;

  const { id, status: zoneStatus, name_servers: nameServers } = match;
  if (typeof id !== "string" || typeof zoneStatus !== "string" || !Array.isArray(nameServers)) {
    throw new CloudflareApiError("Zone tìm được thiếu id/status/name_servers (schema drift).");
  }
  return { id, status: zoneStatus, nameServers: nameServers.filter((n): n is string => typeof n === "string") };
}

export async function getCloudflareZone(zoneId: string, apiToken: string): Promise<CloudflareZone> {
  const { status, body } = await fetchWithCurlFallback(`${CLOUDFLARE_BASE_URL}/zones/${zoneId}`, {
    Authorization: `Bearer ${apiToken}`,
  });
  const envelope = parseCloudflareBody(status, body.toString("utf-8"));
  return toZone(envelope);
}

interface CloudflareEnvelope {
  success: boolean;
  result: Record<string, unknown> | null;
  errors: { code: number; message: string }[];
}

function parseCloudflareBody(httpStatus: number, text: string): CloudflareEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CloudflareApiError(`Cloudflare trả về phản hồi không phải JSON (HTTP ${httpStatus}): ${text.slice(0, 300)}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("success" in parsed)) {
    throw new CloudflareApiError(`Phản hồi Cloudflare thiếu trường "success" — có thể API đã thay đổi cấu trúc (schema drift). HTTP ${httpStatus}.`);
  }
  const envelope = parsed as CloudflareEnvelope;
  if (!envelope.success) {
    const message = envelope.errors?.map((e) => `[${e.code}] ${e.message}`).join("; ") || `HTTP ${httpStatus}, không rõ lý do`;
    throw new CloudflareApiError(`Cloudflare từ chối yêu cầu: ${message}`);
  }
  return envelope;
}

function toZone(envelope: CloudflareEnvelope): CloudflareZone {
  const result = envelope.result;
  if (
    !result ||
    typeof result.id !== "string" ||
    typeof result.status !== "string" ||
    !Array.isArray(result.name_servers)
  ) {
    throw new CloudflareApiError('Phản hồi Cloudflare thiếu id/status/name_servers trong "result" (schema drift).');
  }
  return {
    id: result.id,
    status: result.status,
    nameServers: result.name_servers.filter((ns): ns is string => typeof ns === "string"),
  };
}
