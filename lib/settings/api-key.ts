import crypto from "crypto";
import { getCredential, setCredentials, clearCredential } from "./credentials";

const API_KEY_FIELD = "PSEO_API_KEY";
const API_KEY_PREFIX = "pseo_";

/** The one shared secret external callers (a WordPress/CMS plugin, a
 * build script on the public site) send to read the researched-niche
 * dataset via /api/v1 — see app/api/v1. Stored through the same
 * AppConfig-backed credential store as every other secret in Settings, just
 * generated locally instead of pasted in from a provider. Generating a new
 * key overwrites the old one outright — there's exactly one key at a time,
 * which is enough for "my own site's plugin calls this," not a
 * multi-tenant API product. */
export async function generateApiKey(): Promise<string> {
  const token = API_KEY_PREFIX + crypto.randomBytes(24).toString("hex");
  await setCredentials({ [API_KEY_FIELD]: token });
  return token;
}

export async function revokeApiKey(): Promise<void> {
  await clearCredential(API_KEY_FIELD);
}

export async function getApiKeyStatus(): Promise<{ configured: boolean; masked?: string }> {
  const value = await getCredential(API_KEY_FIELD);
  if (!value) return { configured: false };
  return { configured: true, masked: `${API_KEY_PREFIX}••••${value.slice(-4)}` };
}

/** Timing-safe comparison — this gates a real external API, not just an
 * internal UI form, so a naive === is worth avoiding here specifically. */
export async function verifyApiKey(candidate: string | null | undefined): Promise<boolean> {
  if (!candidate) return false;
  const expected = await getCredential(API_KEY_FIELD);
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
