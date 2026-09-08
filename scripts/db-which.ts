// Answers "which database am I about to talk to" before a command does
// something to it.
//
// Worth its own command because the answer is not visible anywhere else: the
// same repo, the same scripts and the same UI operate on either database, and
// the only difference is a port number inside an environment variable nobody
// reads before hitting enter.
//
// Usage: npm run db:which

import { prisma } from "../lib/db/prisma";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  let where = "(không đọc được DATABASE_URL)";
  let isProduction = false;
  try {
    const u = new URL(url);
    isProduction = u.port === "55433";
    where = `${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    /* giữ nguyên fallback */
  }

  console.log(isProduction ? "\n  >>> PRODUCTION (qua tunnel) <<<\n" : "\n  local (container trên máy này)\n");
  console.log(`  ${where}`);

  // Row counts, because a port number is a claim and these are evidence. If
  // the tunnel is up but pointing somewhere unexpected, this is where it shows.
  const [locations, dataPoints, generations] = await Promise.all([
    prisma.location.count(),
    prisma.dataPoint.count(),
    prisma.aiGeneration.count(),
  ]);
  console.log(`  Location ${locations} · DataPoint ${dataPoints} · AiGeneration ${generations}`);

  const latest = await prisma.dataSnapshot.findFirst({ orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } });
  console.log(`  Snapshot mới nhất: ${latest ? latest.fetchedAt.toISOString() : "chưa có"}\n`);

  if (isProduction) {
    console.log("  Lệnh KHÔNG được chạy khi đang trỏ vào đây:");
    console.log("    prisma migrate dev · prisma migrate reset · prisma db push\n");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
