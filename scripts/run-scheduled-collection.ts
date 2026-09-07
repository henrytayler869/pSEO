// Non-interactive entry point for periodic (cron-driven) data collection.
// Same operation as the "Chạy thu thập dữ liệu" button in the Data
// Collector UI — this just exposes it as a CLI command with an exit code
// that reflects the batch gate outcome, so a standard crontab + log file
// (and any mail/monitoring wrapped around cron) surfaces failures without
// anyone watching a dashboard.
//
// Runs one collection + validation pass per active DataSource that has an
// implemented adapter (nrel_pvwatts, census_acs_housing) — resolveAdapter()
// throws for sources without a real adapter yet, and this script skips
// those rather than failing the whole run.
//
// Exit codes:
//   0  every source's batch gate passed
//   1  at least one source's batch gate failed (BLOCK rate over threshold),
//      or a source's collector errored (missing API key, network failure,
//      schema drift, etc.)
//
// Crontab example (see README for the full setup):
//   0 3 * * 1 cd /path/to/app && npx tsx scripts/run-scheduled-collection.ts >> /var/log/pseo-collector.log 2>&1

import { prisma } from "../lib/db/prisma";
import { resolveAdapter } from "../lib/collector/registry";
import { runCollection } from "../lib/collector/run";
import { validateSnapshot } from "../lib/validation/run";
import { compareToPreviousSnapshot, formatPercentChange } from "../lib/collector/compare";

const IMPLEMENTED_ADAPTER_KEYS = [
  "nrel_pvwatts",
  "census_acs_housing",
  "census_mobility",
  "irs_migration",
  "noaa_climate_normals",
  "eia_electricity",
  "fema_disaster_declarations",
];

// NOAA CDO API enforces a hard 5 req/sec cap — the default concurrency (5)
// plus retry bursts can exceed that, so this source alone runs throttled.
const CONCURRENCY_OVERRIDES: Record<string, number> = { noaa_climate_normals: 4 };

async function main() {
  const startedAt = new Date();
  console.log(`[${startedAt.toISOString()}] Bắt đầu chạy thu thập dữ liệu định kỳ.`);

  const sources = await prisma.dataSource.findMany({
    where: { isActive: true, adapterKey: { in: IMPLEMENTED_ADAPTER_KEYS } },
  });
  if (sources.length === 0) {
    console.error("Không có DataSource nào đang active với adapter đã triển khai — không có gì để chạy.");
    process.exitCode = 1;
    return;
  }

  const locations = await prisma.location.findMany();
  if (locations.length === 0) {
    console.error("Chưa có Location nào được đăng ký — không thể thu thập dữ liệu.");
    process.exitCode = 1;
    return;
  }
  const refs = locations.map((l) => ({ locationId: l.id, zip: l.zip, city: l.city, state: l.state, lat: l.lat, lon: l.lon, countyFips: l.countyFips }));

  let anyFailure = false;

  for (const source of sources) {
    console.log(`\n--- Nguồn: ${source.name} (${source.adapterKey}) ---`);
    try {
      const adapter = await resolveAdapter(source.adapterKey);
      const concurrency = CONCURRENCY_OVERRIDES[source.adapterKey];
      const result = await runCollection({ adapterKey: source.adapterKey, adapter, locations: refs, ...(concurrency ? { concurrency } : {}) });
      console.log(
        `Snapshot ${result.snapshotId} v${result.version} (${result.status}): ${result.pointCount} điểm dữ liệu, ` +
          `${result.locationsFailed} địa điểm lấy dữ liệu thất bại.`
      );
      if (result.status === "SUSPECT") {
        console.error(`CẢNH BÁO: snapshot bị đánh dấu SUSPECT (lệch schema) — ${result.driftMessage ?? "không rõ lý do"}.`);
      }

      const validation = await validateSnapshot(result.snapshotId);
      console.log(
        `Xác thực: ${validation.blockedLocations}/${validation.totalLocations} bị chặn ` +
          `(${(validation.blockRate * 100).toFixed(1)}%) — cổng ${validation.batchGatePassed ? "ĐẠT" : "KHÔNG ĐẠT"}.`
      );
      if (!validation.batchGatePassed) {
        anyFailure = true;
      }

      const comparison = await compareToPreviousSnapshot(result.snapshotId);
      if (comparison) {
        console.log(`So với v${comparison.previousVersion}:`);
        for (const m of comparison.metrics) {
          console.log(
            `  ${m.metric}: ${m.previousAvg.toFixed(2)} -> ${m.currentAvg.toFixed(2)} ${m.unit} ` +
              `(${formatPercentChange(m.percentChange)}, ${m.significantChangeCount}/${m.sampleSize} zip đổi >10%)`
          );
        }
      } else {
        console.log("Snapshot đầu tiên của nguồn này — chưa có dữ liệu cũ để so sánh.");
      }
    } catch (err) {
      console.error(`LỖI khi thu thập từ ${source.name}:`, err instanceof Error ? err.message : err);
      anyFailure = true;
    }
  }

  console.log(`\n[${new Date().toISOString()}] Hoàn tất.`);
  if (anyFailure) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Lỗi không mong đợi khi chạy thu thập định kỳ:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
