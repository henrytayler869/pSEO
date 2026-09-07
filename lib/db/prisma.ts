import { PrismaClient } from "@prisma/client";

/**
 * Load .env when nothing else has.
 *
 * Next loads .env itself from the working directory, so anything served by the
 * app already has DATABASE_URL. Scripts do not: `tsx scripts/…` runs outside
 * Next, and Prisma Client does not read .env on its own. Those scripts appeared
 * to work anyway, which was the problem — they were relying on the variable
 * being present for some reason nobody had established, and the moment that
 * reason went away every script died at once with "Environment variable not
 * found: DATABASE_URL".
 *
 * This matters on the server too, not just here: the scheduled collector runs
 * as `tsx scripts/run-scheduled-collection.ts` from /opt/pseo, outside Next,
 * against the same .env.
 *
 * process.loadEnvFile is Node's own (20.6+), so this needs no dependency. It is
 * guarded so a real environment variable always wins over the file — that is
 * the order systemd and CI expect — and wrapped because .env legitimately does
 * not exist in CI, where DATABASE_URL is supplied directly.
 */
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env, or unreadable. If DATABASE_URL is genuinely absent, Prisma's own
    // error names it precisely — better than anything this could add.
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
