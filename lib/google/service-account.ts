import crypto from "crypto";
import { getCredential, setCredentials, clearCredential } from "@/lib/settings/credentials";

const CREDENTIAL_FIELD = "GOOGLE_SERVICE_ACCOUNT_JSON";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKEN_LIFETIME_SECONDS = 3600; // Google's own max for this grant type

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/**
 * One shared Google Cloud service account authenticates every connected
 * Website's GSC + GA4 calls — the service account's email gets added as a
 * "viewer" on each site's Search Console property and GA4 property, so no
 * per-site OAuth flow or manually-refreshed access token is needed — a
 * pasted-by-hand access token would expire hourly and doesn't scale past
 * one site.
 *
 * Standard OAuth2 "JWT Bearer Token" server-to-server flow (verified
 * against Google's own docs, 2026-09-06) — implemented with Node's built-in
 * crypto instead of the `googleapis` SDK, matching this project's existing
 * no-SDK convention (DataForSEO, PVWatts, GSC).
 */
export async function saveServiceAccountKey(rawJson: string): Promise<ServiceAccountKey> {
  const parsed = parseServiceAccountKey(rawJson);
  await setCredentials({ [CREDENTIAL_FIELD]: rawJson });
  return parsed;
}

export async function clearServiceAccountKey(): Promise<void> {
  await clearCredential(CREDENTIAL_FIELD);
}

export async function getServiceAccountStatus(): Promise<{ configured: boolean; clientEmail?: string }> {
  const raw = await getCredential(CREDENTIAL_FIELD);
  if (!raw) return { configured: false };
  try {
    const parsed = parseServiceAccountKey(raw);
    return { configured: true, clientEmail: parsed.client_email };
  } catch {
    return { configured: true }; // stored but unparsable — surfaced as a status without an email, not a crash
  }
}

function parseServiceAccountKey(rawJson: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Không phải JSON hợp lệ.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("JSON không đúng định dạng Service Account key.");
  }
  const { client_email, private_key } = parsed as Record<string, unknown>;
  if (typeof client_email !== "string" || typeof private_key !== "string") {
    throw new Error('JSON thiếu trường "client_email" hoặc "private_key" — không giống Service Account key tải từ Google Cloud Console.');
  }
  return { client_email, private_key };
}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64url");
}

/** Exchanges the stored service account key for a short-lived access token
 * scoped to the given OAuth scopes. No caching — this app's call volume
 * (a dashboard load, not a hot path) doesn't justify the complexity of
 * tracking per-scope-set expiry, and Google's token endpoint has no
 * meaningful rate-limit concern at this volume. */
export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const raw = await getCredential(CREDENTIAL_FIELD);
  if (!raw) {
    throw new Error(
      "Chưa cấu hình Google Service Account (ở trang Cài đặt) — cần để đọc dữ liệu GSC/GA4 cho các website đã kết nối."
    );
  }
  const { client_email, private_key } = parseServiceAccountKey(raw);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: client_email,
    scope: scopes.join(" "),
    aud: TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
  };
  const unsignedToken = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsignedToken), private_key);
  const assertion = `${unsignedToken}.${base64url(signature)}`;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Trao đổi token với Google thất bại: HTTP ${response.status}. ${errorBody}`);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof (body as Record<string, unknown>).access_token !== "string") {
    throw new Error("Phản hồi token của Google không đúng cấu trúc mong đợi (schema drift) — thiếu access_token.");
  }
  return (body as Record<string, unknown>).access_token as string;
}

/**
 * Google's 403 carries the actual reason in its body. Pull it out.
 *
 * The status alone is ambiguous between three unrelated causes, and the one
 * that hits every new project FIRST — the API not being enabled — was missing
 * from this repo's error messages entirely. Someone acting on those messages
 * would go and re-check property permissions they had already set correctly,
 * because nothing told them the request never reached Search Console or
 * Analytics at all.
 *
 * Google's own sentence is better than any paraphrase: it names the API, the
 * project number, and the exact console URL. So it is quoted rather than
 * replaced.
 */
export function explainGoogleApiError(status: number, body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") message = parsed.error.message;
  } catch {
    // Not JSON — an HTML error page from a proxy, most likely. Fall through.
  }

  if (/has not been used in project|is disabled/i.test(message)) {
    return (
      `API CHƯA ĐƯỢC BẬT trong project Google Cloud — KHÔNG phải vấn đề quyền trên property. ` +
      `Bật nó rồi đợi vài phút. Nguyên văn Google: ${message}`
    );
  }
  if (status === 403) {
    return (
      `HTTP 403. ${message || "(không có thông điệp)"} — kiểm theo thứ tự: (1) API đã bật trong project Google Cloud chưa, ` +
      `(2) email service account đã được thêm quyền đọc chưa, (3) đúng property/định dạng chưa.`
    );
  }
  return `HTTP ${status}. ${message || body.slice(0, 200)}`;
}
