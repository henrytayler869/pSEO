// Đối chiếu bản SQL gộp với bản vòng lặp cũ, trên DỮ LIỆU THẬT.
//
// Viết lại một hàm tổng hợp để nó nhanh hơn 10 lần là lúc dễ đổi kết quả
// nhất mà không ai thấy: trung bình lệch một chút, một niche biến mất, một
// null thành 0. Bản cũ giữ lại ở đây làm chuẩn đối chiếu chứ không phải làm
// dự phòng — nó chạy chậm và chỉ chạy trong phép kiểm này.

import { prisma } from "../lib/db/prisma";
import { getTrafficVerticalSummaries, type TrafficVerticalSummary } from "../lib/queries/traffic-research";

/** Bản CŨ, nguyên văn: lặp từng vertical, tải hết hàng, tính trong JS. */
async function legacy(): Promise<TrafficVerticalSummary[]> {
  const scoredVerticals = await prisma.marketIdentity.findMany({
    where: { marketScores: { some: { mode: "TRAFFIC" } } },
    select: { vertical: true },
    distinct: ["vertical"],
  });

  const summaries: Omit<TrafficVerticalSummary, "rank">[] = [];
  for (const { vertical } of scoredVerticals) {
    const [marketCount, scored] = await Promise.all([
      prisma.marketIdentity.count({ where: { vertical } }),
      prisma.marketIdentity.findMany({
        where: { vertical, marketScores: { some: { mode: "TRAFFIC" } } },
        include: { marketScores: { where: { mode: "TRAFFIC" }, orderBy: { version: "desc" }, take: 1 } },
      }),
    ]);
    const latestScores = scored.map((i) => i.marketScores[0]).filter((s) => s !== undefined);
    const scoreValues = latestScores.map((s) => s.score);
    const cpcValues = latestScores.map((s) => s.cpcInput).filter((v): v is number => v !== null);
    const kdValues = latestScores.map((s) => s.difficultyIndexInput);
    const volumeValues = latestScores.map((s) => s.searchVolumeInput);
    summaries.push({
      vertical,
      marketCount,
      scoredMarketCount: scored.length,
      topScore: scoreValues.length > 0 ? Math.max(...scoreValues) : null,
      avgScore: scoreValues.length > 0 ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length : null,
      avgCpc: cpcValues.length > 0 ? cpcValues.reduce((a, b) => a + b, 0) / cpcValues.length : null,
      avgKeywordDifficulty: kdValues.length > 0 ? kdValues.reduce((a, b) => a + b, 0) / kdValues.length : null,
      totalSearchVolume: volumeValues.length > 0 ? volumeValues.reduce((a, b) => a + b, 0) : null,
    });
  }
  const ranked = [...summaries].sort((a, b) => (b.avgScore ?? -Infinity) - (a.avgScore ?? -Infinity));
  const rankByVertical = new Map(ranked.filter((s) => s.avgScore !== null).map((s, i) => [s.vertical, i + 1]));
  return ranked.map((s) => ({ ...s, rank: rankByVertical.get(s.vertical) ?? null }));
}

/** Số thực đi qua SQL AVG và qua reduce() trong JS lệch nhau ở chữ số cuối.
 * So tuyệt đối sẽ đỏ vì lý do không ai quan tâm; ngưỡng này đủ chặt để bắt
 * một công thức SAI và đủ lỏng để bỏ qua sai số dấu phẩy động. */
const EPS = 1e-9;

function close(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

async function main() {
  const tOld = Date.now();
  const old = await legacy();
  const msOld = Date.now() - tOld;
  const tNew = Date.now();
  const now = await getTrafficVerticalSummaries();
  const msNew = Date.now() - tNew;

  console.log(`bản cũ ${msOld} ms | bản mới ${msNew} ms | nhanh hơn ${(msOld / Math.max(1, msNew)).toFixed(1)}×\n`);

  const fails: string[] = [];
  if (old.length !== now.length) fails.push(`số niche: cũ ${old.length}, mới ${now.length}`);

  const byVertical = new Map(now.map((s) => [s.vertical, s]));
  for (const o of old) {
    const n = byVertical.get(o.vertical);
    if (!n) { fails.push(`thiếu niche "${o.vertical}" ở bản mới`); continue; }
    const checks: [string, boolean][] = [
      ["marketCount", o.marketCount === n.marketCount],
      ["scoredMarketCount", o.scoredMarketCount === n.scoredMarketCount],
      ["topScore", close(o.topScore, n.topScore)],
      ["avgScore", close(o.avgScore, n.avgScore)],
      ["avgCpc", close(o.avgCpc, n.avgCpc)],
      ["avgKeywordDifficulty", close(o.avgKeywordDifficulty, n.avgKeywordDifficulty)],
      ["totalSearchVolume", o.totalSearchVolume === n.totalSearchVolume],
      ["rank", o.rank === n.rank],
    ];
    for (const [field, ok] of checks) {
      if (!ok) fails.push(`${o.vertical}.${field}: cũ ${JSON.stringify(o[field as keyof TrafficVerticalSummary])}, mới ${JSON.stringify(n[field as keyof TrafficVerticalSummary])}`);
    }
  }

  console.log(`đối chiếu ${old.length} niche × 8 trường`);
  if (fails.length === 0) console.log("✓ khớp hoàn toàn");
  else { console.error(`✗ ${fails.length} lệch:`); for (const f of fails) console.error(`   ${f}`); process.exitCode = 1; }
  await prisma.$disconnect();
}
main();
