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

/**
 * Say out loud when this process is pointed at production.
 *
 * With local and production sharing one database over an SSH tunnel, every
 * command in this repo can write real data — and nothing about running
 * `tsx scripts/…` looks any different than it did when the target was a
 * throwaway container on this laptop.
 *
 * The port is what distinguishes them: 5433 is the local container, 55433 is
 * the tunnel. Printed rather than merely documented, because this project has
 * already had one operation land on the wrong database while everyone believed
 * otherwise, and the only thing missing at the time was a line saying where it
 * went.
 */
function announceIfProduction(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes(":55433")) return;
  // Once per process. A warning on every query is a warning nobody reads.
  const g = globalThis as unknown as { __pseoDbAnnounced?: boolean };
  if (g.__pseoDbAnnounced) return;
  g.__pseoDbAnnounced = true;
  console.warn("⚠️  DATABASE PRODUCTION (qua tunnel cổng 55433) — mọi thay đổi là thật, không có undo.");
}
announceIfProduction();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Names the tunnel when the tunnel is what broke.
 *
 * Deliberately NOT an auto-reconnect. Reopening the SSH forward on every
 * failure would hide the fact that the connection is unstable, and an
 * unreliable link to production data is a thing to see, not a thing to paper
 * over. What was actually missing is diagnosis: Prisma reports
 * "Can't reach database server at 127.0.0.1:55433", which is true and sends
 * the reader to look at Postgres — a process that is running perfectly, on a
 * machine they can reach, three thousand kilometres away.
 *
 * Only fires for :55433. The local container on 5433 failing means the
 * container is down, and saying "check the tunnel" there would be the same
 * error in the opposite direction.
 *
 * Measured today: the tunnel dropped with "Operation timed out / Broken pipe"
 * after a network stall. ServerAliveInterval killed it on purpose rather than
 * leaving a socket that accepts connections and never answers — a hung tunnel
 * looks exactly like a slow database, which is far worse to debug than a
 * closed port.
 */
const TUNNEL_PORT = ":55433";

function explainConnectionFailure(error: unknown): unknown {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes(TUNNEL_PORT)) return error;

  const message = error instanceof Error ? error.message : String(error);
  // Prisma's own wording for a refused/unreachable server. Matched loosely
  // because the exact phrasing has changed across versions, and a matcher that
  // only knows one version silently stops helping after an upgrade.
  if (!/can't reach database server|connection refused|ECONNREFUSED|Timed out fetching a new connection/i.test(message)) {
    return error;
  }

  return new Error(
    `Không kết nối được database production qua tunnel (127.0.0.1${TUNNEL_PORT}).\n` +
      `  Nhiều khả năng TUNNEL SSH ĐÃ ĐỨT, không phải Postgres hỏng — Postgres nằm trên VPS và chỉ nghe loopback ở đó.\n` +
      `  Mở lại:      ./scripts/db-tunnel.sh\n` +
      `  Kiểm nhanh:  lsof -ti:55433\n` +
      `  Quay về DB cục bộ: ./scripts/use-db.sh local\n` +
      `  Lỗi gốc: ${message}`
  );
}

/**
 * Every query goes through here so a dead tunnel is named once, at the layer
 * that knows the URL, instead of being re-diagnosed at each of the dozens of
 * call sites that would otherwise each report their own version of it.
 */
function withTunnelDiagnostics(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error) {
          throw explainConnectionFailure(error);
        }
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? withTunnelDiagnostics(new PrismaClient());

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
