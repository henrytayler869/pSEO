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
import { getTransportStats } from "../lib/net/curl-fetch";
import { MissingCredentialError } from "../lib/collector/errors";
import { ALL_ADAPTER_KEYS } from "../lib/collector/registry";

// Imported, not re-listed. A second copy of this list silently drops a source
// from every scheduled run while the report stays green.
const IMPLEMENTED_ADAPTER_KEYS = [...ALL_ADAPTER_KEYS];

// NOAA's 5 req/sec cap is enforced INSIDE its adapter now, by spacing requests
// in time. It is left at a low concurrency here as well, but that is belt and
// braces rather than the mechanism: a concurrency limit caps how many requests
// are in flight, not how many start per second, and four fast requests in
// flight is forty per second. Relying on this line alone is what produced 88
// rejected locations quoting CDO's own words back at us.
//
// Original note, kept because it explains why the number is low:
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
  const skipped: { name: string; credential: string }[] = [];

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
        // SUSPECT has three causes now, not one. This line used to name
        // schema drift unconditionally, which sent a reader hunting for a
        // response-shape change that never happened — the message itself was
        // the misleading signal.
        const reason = result.driftMessage
          ? `lệch schema: ${result.driftMessage}`
          : result.pointCount === 0
            ? "không thu được điểm dữ liệu nào"
            : `${result.locationsFailed}/${result.locationsFailed + result.locationsSucceeded} địa điểm thất bại — quá nửa`;
        console.error(`CẢNH BÁO: snapshot bị đánh dấu SUSPECT — ${reason}.`);
        console.error(`  Dữ liệu cũ vẫn được phục vụ: chỉ snapshot OK mới được đọc xuống dưới.`);
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
      // A source whose credential was never configured is SKIPPED, not failed
      // — but only if it has never produced a good snapshot.
      //
      // Without this, the weekly timer reports failed every Monday forever
      // because NOAA and EIA have no free-tier keys entered. A red light that
      // never changes is a red light people stop reading, and the next real
      // failure hides inside it. That is the same shape as every silent-signal
      // problem this project has chased, arriving through the exit code.
      //
      // The "never produced a snapshot" condition is what keeps this honest.
      // A source that used to work and whose credential has since vanished is
      // a regression, not an unconfigured extra, and still fails the run.
      if (err instanceof MissingCredentialError) {
        const everWorked = await prisma.dataSnapshot.count({ where: { sourceId: source.id, status: "OK" } });
        if (everWorked === 0) {
          skipped.push({ name: source.name, credential: err.credentialName });
          console.log(`BỎ QUA ${source.name}: chưa cấu hình ${err.credentialName} (nguồn này chưa từng chạy).`);
          continue;
        }
        console.error(
          `LỖI ${source.name}: ${err.credentialName} biến mất, nhưng nguồn này TỪNG chạy được — đây là hồi quy, không phải nguồn chưa bật.`
        );
        anyFailure = true;
        continue;
      }
      console.error(`LỖI khi thu thập từ ${source.name}:`, err instanceof Error ? err.message : err);
      anyFailure = true;
    }
  }

  // Which transport served the run. Printed because the curl fallback is
  // silent by design and therefore hides whether the primary network path
  // still works at all: a run where every request fell back succeeds exactly
  // like a healthy one, only slower. First time this was measured, native
  // fetch was serving ZERO requests to api.census.gov — every collection this
  // project has ever done went through curl, and nothing had said so.
  const transport = getTransportStats();
  if (transport.curl > 0) {
    const total = transport.native + transport.curl;
    console.log(
      `\nMạng: ${transport.native}/${total} request đi bằng fetch, ${transport.curl} phải dùng curl thay thế.`
    );
    for (const [host, reason] of Object.entries(transport.fallbackReasons)) {
      console.log(`  ${host}: ${reason}`);
    }
    if (transport.native === 0) {
      console.log(`  fetch() KHÔNG phục vụ được request nào — đường mạng chính đang hỏng hoàn toàn, chỉ là fallback che đi.`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\nBỎ QUA ${skipped.length} nguồn chưa cấu hình (KHÔNG tính là lỗi):`);
    for (const s of skipped) console.log(`  ${s.name} — thiếu ${s.credential}`);
    console.log(`  Nhập ở trang Cài đặt là chúng tự chạy ở lần kế tiếp; không cần sửa lịch.`);
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
