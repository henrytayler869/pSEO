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
