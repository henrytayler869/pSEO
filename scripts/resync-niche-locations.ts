// One-off (re-runnable) fix for a real, discovered drift: Location's zip
// list was regenerated (bulk-recreated 2026-09-05T12:07:07Z) *after* several
// niches were already researched via defineNicheAcrossLocations against the
// OLD zip list. Result: those niches' MarketIdentity rows mostly point at
// zips no longer in Location, so every real Collector DataSource tagged for
// them (Census ACS5, IRS Migration, NOAA, EIA, FEMA, PVWatts) has nothing to
// attach to for ~98% of their markets — confirmed live, 2026-09-06:
//
//   moving-services, solar-installation, mortgage-refinance, medicare-plans,
//   senior-care, pest-control, debt-relief, auto-accident-attorney,
//   tax-relief: 288 zips each, only 6 overlap with the current 300-zip
//   Location table (2.1%).
//
// This script, per vertical:
//   1. defineNicheAcrossLocations(vertical) — additive, skipDuplicates, so
//      existing MarketIdentity rows (and their keyword/score history) are
//      untouched; only adds MarketIdentity for Location zips not yet present.
//   2. Fetches keyword data ONLY for the newly-created identities
//      (fetchKeywordMetricsForIdentityIds) — NOT the whole vertical, so this
//      does not re-bill DataForSEO for markets that already have current
//      keyword data.
//   3. computeTrafficScoresForVertical(vertical) for the whole vertical —
//      local computation, no external cost. This does create a new score
//      version for the pre-existing markets too (same versioning discipline
//      already used everywhere in this app: never overwrite, always append),
//      even though their keyword data didn't change — that's an accepted,
//      intentional side effect of "this niche was re-processed," not a bug.
//
// Costs real DataForSEO credits proportional to the number of newly-created
// markets across all verticals below — this is exactly the tradeoff the
// user was told about and approved before this script was written.

import { prisma } from "../lib/db/prisma";
import { defineNicheAcrossLocations } from "../lib/markets/define-niche";
import { fetchKeywordMetricsForIdentityIds } from "../lib/keywords/import";
import { computeTrafficScoresForVertical } from "../lib/scoring/market-score";

const AFFECTED_VERTICALS = [
  "moving-services",
  "solar-installation",
  "mortgage-refinance",
  "medicare-plans",
  "senior-care",
  "pest-control",
  "debt-relief",
  "auto-accident-attorney",
  "tax-relief",
];

async function main() {
  const verticals = process.argv.slice(2);
  const targets = verticals.length > 0 ? verticals : AFFECTED_VERTICALS;
  console.log(`Đồng bộ lại MarketIdentity theo Location hiện tại cho: ${targets.join(", ")}\n`);

  for (const vertical of targets) {
    console.log(`--- ${vertical} ---`);
    try {
      const before = await prisma.marketIdentity.findMany({ where: { vertical }, select: { id: true } });
      const beforeIds = new Set(before.map((i) => i.id));

      const defineResult = await defineNicheAcrossLocations(vertical);
      console.log(`  Tạo mới ${defineResult.created} market, ${defineResult.alreadyExisted} đã có sẵn (trên ${defineResult.locationCount} Location).`);

      if (defineResult.created === 0) {
        console.log("  Không có market mới — bỏ qua bước lấy từ khóa.");
        continue;
      }

      const after = await prisma.marketIdentity.findMany({ where: { vertical }, select: { id: true } });
      const newIds = after.map((i) => i.id).filter((id) => !beforeIds.has(id));

      const keywordResult = await fetchKeywordMetricsForIdentityIds(newIds);
      console.log(`  Từ khóa: ${keywordResult.count} dòng qua ${keywordResult.sourceName} cho ${newIds.length} market mới, ${keywordResult.marketsMissingData} thiếu dữ liệu.`);

      const scoreResult = await computeTrafficScoresForVertical(vertical);
      console.log(`  Đã tính điểm cho ${scoreResult.length} market (toàn bộ ngành, không chỉ market mới).`);
    } catch (err) {
      console.error(`  LỖI:`, err instanceof Error ? err.message : err);
    }
    console.log();
  }
}

main()
  .catch((err) => {
    console.error("Lỗi không mong đợi:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
