const CLOUDFLARE_BASE_URL = "https://api.cloudflare.com/client/v4";

import { CloudflareApiError } from "./zones";

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

async function callCloudflare(
  path: string,
  apiToken: string,
  init: { method: string; body?: unknown }
): Promise<unknown> {
  const response = await fetch(`${CLOUDFLARE_BASE_URL}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CloudflareApiError(`Cloudflare trả về phản hồi không phải JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  const envelope = (parsed ?? {}) as Record<string, unknown>;
  if (envelope.success !== true) {
    const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
    const detail = errors
      .map((e) => {
        const err = e as Record<string, unknown>;
        return `${err.code}: ${err.message}`;
      })
      .join("; ");
    throw new CloudflareApiError(`Cloudflare từ chối (HTTP ${response.status}): ${detail || "không rõ lý do"}`);
  }
  return envelope.result;
}

function toRecord(raw: unknown): DnsRecord {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    type: String(r.type ?? ""),
    name: String(r.name ?? ""),
    content: String(r.content ?? ""),
    proxied: r.proxied === true,
  };
}

/**
 * Finds an existing record by exact name and type.
 *
 * Exact, because Cloudflare's list endpoint matches loosely by default and a
 * substring match here would find `wp-atmoving.cornships.com` when asked about
 * `atmoving.cornships.com` — then "already exists" would be reported for a
 * hostname that does not.
 *
 * An empty list is a real answer (no such record), not a failure.
 */
export async function findDnsRecord(
  zoneId: string,
  name: string,
  type: string,
  apiToken: string
): Promise<DnsRecord | null> {
  const result = await callCloudflare(
    `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`,
    apiToken,
    { method: "GET" }
  );
  if (!Array.isArray(result)) {
    throw new CloudflareApiError("Cloudflare không trả về mảng cho danh sách DNS record (schema drift).");
  }
  const exact = result.map(toRecord).find((r) => r.name.toLowerCase() === name.toLowerCase() && r.type === type);
  return exact ?? null;
}

/**
 * Creates the record, or reports the existing one unchanged.
 *
 * Never overwrites. A subdomain that already points somewhere is pointing
 * there for a reason this code cannot see, and silently repointing it is how a
 * live hostname moves without anyone deciding to move it. The caller is told
 * what is there and decides.
 */
export async function ensureDnsRecord(
  zoneId: string,
  name: string,
  content: string,
  apiToken: string,
  options: { type?: string; proxied?: boolean; ttl?: number } = {}
): Promise<{ record: DnsRecord; created: boolean }> {
  const type = options.type ?? "A";
  const existing = await findDnsRecord(zoneId, name, type, apiToken);
  if (existing) return { record: existing, created: false };

  const result = await callCloudflare(`/zones/${zoneId}/dns_records`, apiToken, {
    method: "POST",
    body: {
      type,
      name,
      content,
      // 1 means "automatic" to Cloudflare. Only meaningful for unproxied
      // records; a proxied record's TTL is the edge's business.
      ttl: options.ttl ?? 1,
      proxied: options.proxied ?? true,
    },
  });
  return { record: toRecord(result), created: true };
}
