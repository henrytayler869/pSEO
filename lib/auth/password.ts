import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";

/**
 * The single admin password, stored as a scrypt hash in AppConfig.
 *
 * Never in the repository, and never in .env. The repository is on GitHub and
 * a password committed once stays in history after it is "removed"; .env is
 * better but still a file that gets copied, backed up and screenshotted. The
 * database is where every other secret in this app already lives, behind
 * Settings, and it is the thing that does not travel with the code.
 *
 * Only a HASH is stored, so reading the database does not yield the password.
 * scrypt with a per-password salt makes each guess expensive — which matters
 * more than usual here, because a short password is exactly what this is
 * expected to hold.
 */

const CONFIG_KEY = "auth";
const HASH_FIELD = "adminPasswordHash";

// Node's defaults are deliberately raised: N=2^16 costs ~100ms per attempt,
// which is invisible on a login form and brutal against an offline guess.
const SCRYPT_N = 65536;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 256 * 1024 * 1024; // N=2^16 needs more than the 32MB default

function hashWith(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, maxmem: SCRYPT_MAXMEM });
}

/** "scrypt$<salt-hex>$<hash-hex>" — the salt travels with the hash so the
 * parameters are readable from the stored value alone. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${hashWith(password, salt).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = hashWith(password, Buffer.from(saltHex, "hex"));
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export async function getAdminPasswordHash(): Promise<string | null> {
  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const hash = value[HASH_FIELD];
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

export async function setAdminPassword(password: string): Promise<void> {
  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  const existing = (row?.value ?? {}) as Record<string, unknown>;
  const next = { ...existing, [HASH_FIELD]: hashPassword(password) };
  await prisma.appConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: next },
    update: { value: next },
  });
}
