// Non-interactive entry point for periodic niche research — same "define
// niche across every real zip → fetch keyword data → score on traffic
// potential" pipeline as the "Chạy nghiên cứu" button on /markets/research,
// exposed as a CLI command for cron so the candidate-niche backlog
// (lib/markets/candidate-niches.ts, editable via AppConfig key
// "candidateNiches") gets worked through gradually without anyone clicking
// anything — this is the "định kỳ 2 tuần/lần, niche nào đã nghiên cứu thì
// bỏ qua" ask, same shape as scripts/run-scheduled-collection.ts.
//
// Processes up to NICHE_RESEARCH_BATCH_SIZE suggested niches per run
// (default 3) — capped deliberately, since each niche fans out to one
// DataForSEO request per real zip on file, and DataForSEO bills per call.
// Already-researched niches (any MarketIdentity existing for that vertical,
// PAYOUT or TRAFFIC) are skipped automatically by getSuggestedNiches().
//
// Exit codes:
//   0  every niche processed this run succeeded (including "nothing to do")
//   1  at least one niche failed (e.g. DataForSEO not configured)
//
// Crontab example (see README for the full setup) — cron has no native
// "every 14 days" schedule, so 1st-and-15th-of-the-month is the practical
// stand-in for "twice a month":
//   0 3 1,15 * * cd /path/to/app && npx tsx scripts/run-scheduled-niche-research.ts >> /var/log/pseo-niche-research.log 2>&1

import { prisma } from "../lib/db/prisma";
import { getSuggestedNiches } from "../lib/markets/candidate-niches";
import { defineNicheAcrossLocations } from "../lib/markets/define-niche";
import { fetchKeywordMetricsForVertical } from "../lib/keywords/import";
import { fetchAndStoreRelatedKeywords } from "../lib/keywords/related-keywords";
import { computeTrafficScoresForVertical } from "../lib/scoring/market-score";

const DEFAULT_BATCH_SIZE = 3;

async function main() {
  const startedAt = new Date();
  console.log(`[${startedAt.toISOString()}] Bắt đầu chạy nghiên cứu niche định kỳ.`);

  const batchSize = Number(process.env.NICHE_RESEARCH_BATCH_SIZE ?? DEFAULT_BATCH_SIZE);
  const suggestions = (await getSuggestedNiches()).slice(0, batchSize);

  if (suggestions.length === 0) {
    console.log("Không còn niche nào trong danh sách gợi ý chưa được nghiên cứu — không có gì để chạy.");
    return;
  }

  console.log(`Sẽ xử lý ${suggestions.length} niche: ${suggestions.map((s) => s.vertical).join(", ")}`);

  let anyFailure = false;

  for (const candidate of suggestions) {
    console.log(`\n--- Niche: ${candidate.vertical} (${candidate.label}) ---`);
    try {
      const defineResult = await defineNicheAcrossLocations(candidate.vertical);
      console.log(
        `  Tạo thị trường: ${defineResult.created} mới, ${defineResult.alreadyExisted} đã có sẵn, trên ${defineResult.locationCount} zip.`
      );

      const keywordResult = await fetchKeywordMetricsForVertical(candidate.vertical);
      console.log(
        `  Từ khóa: ${keywordResult.count} dòng qua ${keywordResult.sourceName}, ${keywordResult.marketsMissingData} thị trường thiếu dữ liệu.`
      );

      const scoreResult = await computeTrafficScoresForVertical(candidate.vertical);
      console.log(`  Đã tính điểm cho ${scoreResult.length} thị trường.`);

      try {
        const semanticResult = await fetchAndStoreRelatedKeywords(candidate.vertical);
        console.log(`  Từ khóa liên quan (semantic): ${semanticResult.count}.`);
      } catch (err) {
        console.error(`  Lấy từ khóa liên quan thất bại (không chặn niche này):`, err instanceof Error ? err.message : err);
      }
    } catch (err) {
      console.error(`  LỖI khi xử lý niche ${candidate.vertical}:`, err instanceof Error ? err.message : err);
      anyFailure = true;
    }
  }

  console.log(`\n[${new Date().toISOString()}] Hoàn tất.`);
  if (anyFailure) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Lỗi không mong đợi khi chạy nghiên cứu niche định kỳ:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
