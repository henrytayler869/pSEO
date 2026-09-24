/**
 * Bảng tên đội hiển thị có khớp nguồn không, và có đội nào trùng tên không.
 *
 *     npm run verify:team-display-names
 *
 * ═══ HAI LỖI CÂM MÀ CỔNG NÀY CANH ═══
 *
 * **Khoá viết sai chính tả.** `TEAM_DISPLAY_NAMES` khớp NGUYÊN VĂN tên
 * openfootball. Một khoá sai một ký tự — "Manchester Utd FC", "FC Bayern
 * Munchen" thiếu dấu — thì không khớp hàng nào, không đổi gì, và `football:sync`
 * chạy xanh báo "đổi tên 11" thay vì 12. Không ai đếm con số đó.
 *
 * **Hai đội cùng tên hiển thị.** Đây là lỗi đắt hơn. Bộ 263 ứng viên đo
 * 24/9/2026 từng đề xuất "barcelona" cho **RCD Espanyol de Barcelona** —
 * chuỗi ấy mượn volume của FC Barcelona. Nếu lọt vào bảng thì hai CLB khác
 * hẳn nhau có cùng H1, cùng title, và MỌI CON SỐ TRÊN CẢ HAI TRANG VẪN ĐÚNG.
 * Không validator nào trong kho bắt được: chúng so văn với fact, không so
 * tên với thực tế.
 *
 * ═══ ĐỌC MẠNG, NÊN KHÔNG NẰM TRONG CI ═══
 *
 * Cùng lý lẽ với `verify:openfootball` (xem AGENTS.md): một lần GitHub trục
 * trặc sẽ làm đỏ PR của mọi phiên mà không nói gì về code. Chạy tay.
 */
import { LEAGUES, fetchLeagueSeasonMerged, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import { TEAM_DISPLAY_NAMES, teamDisplayName } from "@/lib/football/team-display-names";

async function main(): Promise<void> {
  const now = new Date();
  const season = currentEuropeanSeason(now);

  const sourceNames: string[] = [];
  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeasonMerged(code, season, now);
    sourceNames.push(...s.teams);
  }
  console.log(`Nguồn: ${sourceNames.length} đội ở ${Object.keys(LEAGUES).length} giải, mùa ${season}.`);

  let failed = 0;
  const fail = (msg: string) => {
    console.error(`  ✗ ${msg}`);
    failed++;
  };

  // 1. Mọi khoá trong bảng phải TỒN TẠI trong nguồn.
  const bySource = new Set(sourceNames);
  for (const key of Object.keys(TEAM_DISPLAY_NAMES)) {
    if (!bySource.has(key)) {
      fail(`khoá "${key}" không có trong nguồn — bảng sẽ không đổi được gì cho nó`);
    }
  }

  // 2. Không hai đội nào ra cùng một tên hiển thị.
  const byDisplay = new Map<string, string[]>();
  for (const name of sourceNames) {
    const shown = teamDisplayName(name);
    byDisplay.set(shown, [...(byDisplay.get(shown) ?? []), name]);
  }
  for (const [shown, sources] of byDisplay) {
    if (sources.length > 1) {
      fail(`tên hiển thị "${shown}" dùng cho ${sources.length} đội: ${sources.join(" | ")}`);
    }
  }

  const overridden = sourceNames.filter((n) => n in TEAM_DISPLAY_NAMES).length;
  console.log(`Bảng khai ${Object.keys(TEAM_DISPLAY_NAMES).length} đội; khớp được ${overridden}.`);
  console.log(`${sourceNames.length - overridden} đội giữ tên openfootball (cố ý — xem chú thích của bảng).`);

  if (failed > 0) {
    console.error(`\n✗ ${failed} vấn đề.\n`);
    process.exit(1);
  }
  console.log("\n✓ Bảng tên đội khớp nguồn, không đội nào trùng tên hiển thị.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
