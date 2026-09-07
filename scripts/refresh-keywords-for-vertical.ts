// Re-runs keyword research for one vertical using the multi-candidate
// phrasing picker (lib/keywords/patterns.ts), then reports what changed and
// how much keyword cannibalisation exists afterwards.
//
// Why this isn't just fetchKeywordMetricsForVertical():
//
// 1. KeywordMetric is insert-only, and computeTrafficValues() SUMS
//    searchVolume across a market's distinct keywords. That's correct when
//    a market genuinely targets several different queries — but the old and
//    new phrasings ("moving services chicago" / "movers chicago") are two
//    measurements of the SAME query. Leaving both would report Chicago's
//    demand as 480 + 14,800 = 15,280, which is not a number that exists.
//    So superseded rows are deleted, and ONLY those: a row is removed only
//    when its keyword is another candidate phrasing for that market's own
//    place, never a genuinely different keyword someone added on purpose.
//
// 2. Changing the phrasing changes which markets share a keyword, which is
//    what the consuming site groups pages by. That has to be reported, not
//    discovered later on a live site.
//
// Usage: tsx scripts/refresh-keywords-for-vertical.ts <vertical> [--dry-run]

import { prisma } from "../lib/db/prisma";
import { resolveKeywordAdapter } from "../lib/keywords/import";
import { getKeywordTemplates, getPlacesNeedingStateSuffix, applyStateSuffix } from "../lib/keywords/patterns";
import { latestPerKeyword } from "../lib/keywords/latest";
import { computeTrafficScoresForVertical } from "../lib/scoring/market-score";

function sanitizePlaceForKeyword(city: string): string {
  const withoutParenthetical = city.replace(/\s*\([^)]*\)\s*$/, "");
  return withoutParenthetical.split(/[-/]/)[0].trim().toLowerCase();
}

async function main() {
  const vertical = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  // --zips 93535,93536 — re-measure only these markets. Useful when a
  // config change (e.g. a new state-suffix entry) affects a handful of
  // markets and re-measuring the whole vertical would bill DataForSEO for
  // hundreds of phrases that cannot have changed.
  const zipsArg = process.argv.indexOf("--zips");
  const zipFilter = zipsArg !== -1 ? (process.argv[zipsArg + 1] ?? "").split(",").map((z) => z.trim()).filter(Boolean) : null;
  if (!vertical) {
    console.error("Cách dùng: tsx scripts/refresh-keywords-for-vertical.ts <vertical> [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const identities = await prisma.marketIdentity.findMany({
    where: { vertical, ...(zipFilter ? { zip: { in: zipFilter } } : {}) },
    include: { keywordMetrics: true },
  });
  if (zipFilter) console.log(`Chỉ xử lý ${zipFilter.length} zip được chỉ định.`);
  if (identities.length === 0) {
    console.error(`Không có MarketIdentity nào cho "${vertical}".`);
    process.exitCode = 1;
    return;
  }

  const templates = await getKeywordTemplates(vertical);
  console.log(`Ngành: ${vertical} — ${identities.length} market`);
  console.log(`Cách viết ứng viên (${templates.length}): ${templates.join(" | ")}`);

  // Warn about city names shared across states that aren't configured —
  // they would generate one identical keyword for two genuinely different
  // cities, which is how pages start cannibalising each other.
  const needing = await getPlacesNeedingStateSuffix();
  const statesByPlace = new Map<string, Set<string>>();
  for (const i of identities) {
    if (!i.city) continue;
    const p = sanitizePlaceForKeyword(i.city);
    if (!statesByPlace.has(p)) statesByPlace.set(p, new Set());
    statesByPlace.get(p)!.add(i.state);
  }
  const unconfigured = [...statesByPlace.entries()].filter(
    ([p, states]) => states.size > 1 && (needing[p]?.length ?? 0) < states.size - 1
  );
  if (unconfigured.length > 0) {
    console.log("\n⚠️  Tên thành phố dùng chung ở nhiều bang, chưa cấu hình đủ trong placesNeedingStateSuffix:");
    for (const [p, states] of unconfigured) {
      console.log(`     "${p}" -> ${[...states].join(", ")}  (đã cấu hình: ${(needing[p] ?? []).join(", ") || "không có"})`);
    }
    console.log("     Các market này sẽ sinh ra CÙNG một từ khoá và tự cạnh tranh nhau.\n");
  }

  const places = new Set(
    identities.map((i) =>
      applyStateSuffix(
        i.city ? sanitizePlaceForKeyword(i.city) : `${i.state.toLowerCase()} ${i.zip}`,
        i.state,
        needing
      )
    )
  );
  console.log(`Địa danh riêng biệt: ${places.size} → sẽ đo ${places.size * templates.length} cụm từ khoá\n`);

  const before = new Map<string, { keyword: string; sv: number }>();
  for (const i of identities) {
    const m = latestPerKeyword(i.keywordMetrics)[0];
    if (m) before.set(i.id, { keyword: m.keyword, sv: m.searchVolume });
  }

  if (dryRun) {
    console.log("--dry-run: dừng trước khi gọi DataForSEO.");
    return;
  }

  const adapter = await resolveKeywordAdapter();
  const results = await adapter.fetchForMarkets(
    identities.map((i) => ({ marketIdentityId: i.id, zip: i.zip, city: i.city, state: i.state, vertical: i.vertical }))
  );
  console.log(`DataForSEO trả về ${results.length}/${identities.length} market có dữ liệu.\n`);

  // --- Dọn dòng cũ bị thay thế (xem lý do ở đầu file) ---
  let deleted = 0;
  if (!dryRun) {
    for (const i of identities) {
      const winner = results.find((r) => r.marketIdentityId === i.id);
      if (!winner) continue; // no fresh measurement — leave whatever is there alone

      // Delete every prior row this pipeline wrote for the market, keeping
      // only the fresh winner.
      //
      // An earlier version scoped the delete to "candidate phrasings of
      // this market's place", which broke the moment a place STRING
      // changed: adding the state suffix turned "lancaster" into
      // "lancaster ca", so the old "movers lancaster" row no longer matched
      // any candidate, survived the cleanup, and computeTrafficValues()
      // summed both into 1,210 SV — a number that does not exist. Scoping
      // by SOURCE instead is immune to the place string changing, while
      // still preserving any row a human or a different adapter added
      // (different `source` value).
      const supersededIds = i.keywordMetrics
        .filter((m) => m.source === adapter.sourceName && m.keyword.toLowerCase() !== winner.keyword.toLowerCase())
        .map((m) => m.id);
      if (supersededIds.length > 0) {
        const r = await prisma.keywordMetric.deleteMany({ where: { id: { in: supersededIds } } });
        deleted += r.count;
      }
    }
  }
  console.log(`Đã xoá ${deleted} dòng KeywordMetric bị thay thế (cách viết cũ của cùng địa danh).`);

  await prisma.keywordMetric.createMany({
    data: results.map((r) => ({
      marketIdentityId: r.marketIdentityId,
      keyword: r.keyword,
      searchVolume: r.searchVolume,
      keywordDifficulty: r.keywordDifficulty,
      cpc: r.cpc,
      source: adapter.sourceName,
    })),
  });
  console.log(`Đã ghi ${results.length} dòng mới.\n`);

  // --- Thay đổi cách viết ---
  const changes: { zip: string; from: string; fromSv: number; to: string; toSv: number }[] = [];
  for (const r of results) {
    const b = before.get(r.marketIdentityId);
    const identity = identities.find((i) => i.id === r.marketIdentityId)!;
    if (b && b.keyword.toLowerCase() !== r.keyword.toLowerCase()) {
      changes.push({ zip: identity.zip, from: b.keyword, fromSv: b.sv, to: r.keyword, toSv: r.searchVolume });
    }
  }
  const byPhrase = new Map<string, { from: string; fromSv: number; toSv: number; n: number }>();
  for (const c of changes) {
    const k = `${c.from} => ${c.to}`;
    const e = byPhrase.get(k);
    byPhrase.set(k, { from: k, fromSv: c.fromSv, toSv: c.toSv, n: (e?.n ?? 0) + 1 });
  }
  console.log(`=== ĐỔI CÁCH VIẾT: ${changes.length} market, ${byPhrase.size} cụm từ khoá ===`);
  for (const [, e] of [...byPhrase.entries()].sort((a, b) => b[1].toSv / (b[1].fromSv || 1) - a[1].toSv / (a[1].fromSv || 1))) {
    const mult = e.fromSv > 0 ? (e.toSv / e.fromSv).toFixed(1) : "∞";
    console.log(`  ${String(e.n).padStart(3)} market | ${e.fromSv} -> ${e.toSv} SV (${mult}x) | ${e.from}`);
  }

  // --- Guardrail: không market nào được có >1 keyword ---
  // computeTrafficValues() SUMS searchVolume across a market's keywords, so
  // two rows for one market silently invent demand that doesn't exist. This
  // has happened for real (a place string changed and the old row survived
  // cleanup), and it produced a plausible-looking wrong number rather than
  // an error — so it is asserted here, before scoring consumes it.
  const afterCleanup = await prisma.marketIdentity.findMany({ where: { vertical }, include: { keywordMetrics: true } });
  const doubled = afterCleanup.filter((i) => latestPerKeyword(i.keywordMetrics).length > 1);
  if (doubled.length > 0) {
    console.error(`\n❌ ${doubled.length} market có nhiều hơn 1 keyword — searchVolume sẽ bị CỘNG DỒN:`);
    for (const d of doubled.slice(0, 10)) {
      console.error(`   ${d.zip} ${d.state}: ${latestPerKeyword(d.keywordMetrics).map((k) => `"${k.keyword}"`).join(", ")}`);
    }
    throw new Error("Dừng trước khi chấm điểm — dữ liệu keyword không nhất quán, chấm điểm bây giờ sẽ ghi điểm sai.");
  }

  // --- Chấm điểm lại ---
  const scored = await computeTrafficScoresForVertical(vertical);
  console.log(`\nĐã chấm điểm lại ${scored.length} market.`);

  // --- Báo cáo ăn thịt từ khoá (keyword cannibalisation) ---
  // Đếm trên MỌI market có keyword, không chỉ market dựng được trang: một
  // từ khoá dùng chung là rủi ro tự cạnh tranh bất kể trang nào được dựng.
  const fresh = await prisma.marketIdentity.findMany({ where: { vertical }, include: { keywordMetrics: true } });
  const byKeyword = new Map<string, string[]>();
  for (const i of fresh) {
    const m = latestPerKeyword(i.keywordMetrics)[0];
    if (!m) continue;
    byKeyword.set(m.keyword, [...(byKeyword.get(m.keyword) ?? []), i.zip]);
  }
  const shared = [...byKeyword.entries()].filter(([, z]) => z.length > 1).sort((a, b) => b[1].length - a[1].length);
  const zipsShared = shared.reduce((s, [, z]) => s + z.length, 0);
  console.log(`\n=== ĂN THỊT TỪ KHOÁ ===`);
  console.log(`${byKeyword.size} từ khoá riêng biệt trên ${[...byKeyword.values()].flat().length} market có dữ liệu`);
  console.log(`${shared.length} từ khoá bị nhiều market dùng chung, phủ ${zipsShared} market`);
  console.log(`Top 10:`);
  for (const [kw, zips] of shared.slice(0, 10)) {
    console.log(`  ${String(zips.length).padStart(3)} market | ${kw}`);
  }
  console.log(
    `\nLưu ý: dùng chung từ khoá KHÔNG tự nó là lỗi — nhiều zip trong cùng thành phố ` +
      `thật sự phục vụ một truy vấn. Nó chỉ thành vấn đề khi mỗi zip được dựng một trang riêng. ` +
      `Đó là lý do site gom cụm thay vì dựng trang cho từng zip.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
