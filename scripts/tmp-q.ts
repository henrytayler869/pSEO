import { prisma } from "../lib/db/prisma";
import { buildFillQueue } from "../lib/queries/fill-queue";
import { COST_PER_PASSAGE_USD } from "../lib/ai/fill-queue";
async function main() {
  for (const w of await prisma.website.findMany({ select: { url: true, vertical: true, aiBudgetUsd: true } })) {
    const q = await buildFillQueue(w.vertical);
    const host = w.url.replace(/^https?:\/\//, "");
    console.log(`  ${host.padEnd(24)} niche ${w.vertical.padEnd(24)} ngân sách ${w.aiBudgetUsd ?? "chưa đặt"}`);
    console.log(`      chờ điền: ${q.pending.length}   ước tính: $${(q.pending.length * COST_PER_PASSAGE_USD).toFixed(2)}`);
    if (q.pending[0]) console.log(`      đứng đầu: ZIP ${q.pending[0].zip}`);
  }
}
void main().finally(() => prisma.$disconnect());
