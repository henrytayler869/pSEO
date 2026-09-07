/**
 * Signed session cookie for the Control Panel UI.
 *
 * Uses WebCrypto rather than node:crypto because this is verified in
 * middleware, which does not run in the Node runtime. One implementation for
 * both places beats two that can drift.
 *
 * The token carries nothing but an expiry — there is exactly one account, so
 * there is no identity to encode. That also means it cannot leak anything if
 * read: the whole secret is the signature.
 */

export const SESSION_COOKIE = "pseo_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — a working day, then log in again

/**
 * Whether the UI requires a login at all.
 *
 * Off on localhost by design: development is a single person on their own
 * machine, and a login screen between them and every reload is friction with
 * nothing on the other side of it. On the public host it is the only thing
 * standing in front of pages that can read API keys and start spending.
 *
 * PSEO_REQUIRE_LOGIN overrides in both directions, so the production path can
 * be exercised locally instead of first meeting it in production.
 */
export function loginRequired(): boolean {
  const override = process.env.PSEO_REQUIRE_LOGIN;
  if (override === "1") return true;
  if (override === "0") return false;
  return process.env.NODE_ENV === "production";
}

function secret(): string | null {
  const value = process.env.SESSION_SECRET;
  return value && value.length >= 32 ? value : null;
}

/**
 * Fails CLOSED. A production deployment with no SESSION_SECRET cannot sign or
 * verify anything, so every request is unauthenticated and every page
 * redirects to a login that will refuse — rather than the alternative, where a
 * missing secret quietly disables the gate and publishes the panel.
 */
export function isConfigured(): boolean {
  return secret() !== null;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(new Uint8Array(mac)).toString("base64url");
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${await sign(expiresAt)}`;
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !isConfigured()) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;

  const expected = await sign(expiresAt);
  // Length-then-constant-time comparison. A plain === leaks how much of the
  // signature matched through timing, which is exactly the shape an attacker
  // needs to forge one byte at a time.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return false;

  // Expiry is checked AFTER the signature, so an unsigned token can never
  // reach this branch and learn anything from how it behaves.
  return Number(expiresAt) > Date.now();
}
