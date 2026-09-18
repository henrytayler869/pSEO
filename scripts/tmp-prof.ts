import { prisma } from "../lib/db/prisma";
import { getTrafficRankedMarkets } from "../lib/queries/traffic-research";
import { getCachedInterpretation } from "../lib/ai/generate";
async function main() {
  const V = "moving-services";
  let t = Date.now();
  const markets = await getTrafficRankedMarkets(V);
  console.log(`  getTrafficRankedMarkets: ${Date.now() - t} ms, ${markets.length} thị trường`);
  t = Date.now();
  for (const m of markets.slice(0, 5)) await getCachedInterpretation(V, m.zip);
  const per = (Date.now() - t) / 5;
  console.log(`  getCachedInterpretation: ${per.toFixed(0)} ms/ZIP (đo 5 lần, tuần tự)`);
  console.log(`  → 400 ZIP tuần tự ≈ ${(per * 400 / 1000 / 60).toFixed(1)} phút cho MỘT site`);
}
void main().finally(() => prisma.$disconnect());
