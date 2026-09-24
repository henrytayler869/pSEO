/**
 * Quy đổi giờ thi đấu sang giờ Việt Nam có đúng không — nhất là ở ranh giới DST.
 *
 *     npm run verify:fixture-schedule
 *
 * ═══ VÌ SAO CỔNG NÀY TỒN TẠI ═══
 *
 * Sai múi giờ KHÔNG ném lỗi. Nó trả về một con số hợp lệ, in ra một trang
 * đẹp, và chỉ lộ khi có người bật TV thấy trận đã đá xong. Sai phổ biến nhất
 * là lệch ĐÚNG MỘT TIẾNG: cộng một độ lệch cố định thì đúng nửa năm và sai
 * nửa còn lại, vì Anh đổi giờ cuối tháng 10 còn lục địa đổi ngày khác.
 *
 * Nên phần lớn cổng này là các MỐC hai phía ranh giới DST, tính tay từ quy
 * tắc múi giờ chứ không lấy lại từ chính hàm đang kiểm.
 *
 * Phần đọc mạng nằm ở cuối và CHỈ cảnh báo, không làm đỏ: cùng lý lẽ với
 * `verify:openfootball` trong AGENTS.md — một lần GitHub trục trặc không
 * được làm đỏ PR của người khác. Phần mốc thì thuần tính toán, luôn chạy.
 */
import { LEAGUE_TIMEZONE, upcomingMatches, zonedWallClockToInstant, VN_TIMEZONE } from "@/lib/football/fixtures";
import { fetchLeagueSeasonMerged, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";

let failed = 0;
function check(ok: boolean, label: string, got?: string): void {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${got ? ` — nhận: ${got}` : ""}`);
    failed++;
  }
}

function vn(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: VN_TIMEZONE, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(at);
}

/**
 * Mốc tính TAY, hai phía ranh giới DST.
 *
 * Anh: BST (UTC+1) tới Chủ nhật cuối tháng 10 — 25/10/2026 — rồi về GMT
 * (UTC+0). Việt Nam là UTC+7 quanh năm, không có DST.
 *
 *   15:00 BST  = 14:00 UTC = 21:00 VN   (trước 25/10)
 *   15:00 GMT  = 15:00 UTC = 22:00 VN   (sau 25/10)
 *
 * Lục địa: CEST (UTC+2) tới cùng Chủ nhật cuối tháng 10, rồi CET (UTC+1).
 *
 *   21:00 CEST = 19:00 UTC = 02:00 VN NGÀY HÔM SAU
 *   15:30 CEST = 13:30 UTC = 20:30 VN
 *   20:45 CET  = 19:45 UTC = 02:45 VN NGÀY HÔM SAU
 */
const ANCHORS: { date: string; time: string; tz: string; want: string; why: string }[] = [
  { date: "2026-10-10", time: "15:00", tz: "Europe/London", want: "10/10/2026, 21:00", why: "EPL 15:00 BST -> 21:00 VN (TRƯỚC đổi giờ)" },
  { date: "2026-11-07", time: "15:00", tz: "Europe/London", want: "07/11/2026, 22:00", why: "EPL 15:00 GMT -> 22:00 VN (SAU đổi giờ) — lệch 1 tiếng so với mốc trên" },
  { date: "2026-09-19", time: "15:30", tz: "Europe/Berlin", want: "19/09/2026, 20:30", why: "Bundesliga 15:30 CEST -> 20:30 VN" },
  { date: "2026-09-19", time: "21:00", tz: "Europe/Madrid", want: "20/09/2026, 02:00", why: "La Liga 21:00 CEST -> 02:00 VN NGÀY HÔM SAU" },
  { date: "2026-11-21", time: "20:45", tz: "Europe/Rome", want: "22/11/2026, 02:45", why: "Serie A 20:45 CET -> 02:45 VN ngày hôm sau (SAU đổi giờ)" },
];

console.log("── Mốc quy đổi, tính tay từ quy tắc múi giờ");
for (const a of ANCHORS) {
  const at = zonedWallClockToInstant(a.date, a.time, a.tz);
  const got = at ? vn(at) : "null";
  check(got === a.want, a.why, got === a.want ? undefined : `${got} (mong ${a.want})`);
}

console.log("\n── Ngày Việt Nam PHẢI lệch khi trận đá đêm châu Âu");
{
  const at = zonedWallClockToInstant("2026-09-19", "21:00", "Europe/Madrid")!;
  check(vn(at).startsWith("20/09"), "trận 19/9 ở Tây Ban Nha rơi sang 20/9 giờ Việt Nam", vn(at));
}

console.log("\n── Mọi giải phải khai múi giờ");
for (const code of ["en.1", "es.1", "it.1", "de.1", "fr.1"]) {
  check(Boolean(LEAGUE_TIMEZONE[code]), `${code} có múi giờ (${LEAGUE_TIMEZONE[code] ?? "THIẾU"})`);
}

console.log("\n── Chuỗi giờ hỏng phải trả null, KHÔNG phải một giờ bịa");
check(zonedWallClockToInstant("2026-10-10", "khong-phai-gio", "Europe/London") === null, "giờ sai định dạng -> null");
check(zonedWallClockToInstant("hom-nay", "15:00", "Europe/London") === null, "ngày sai định dạng -> null");

if (failed > 0) {
  console.error(`\n✗ ${failed} phép kiểm đỏ.\n`);
  process.exit(1);
}

// ── Phần đọc mạng: chỉ báo, không làm đỏ.
(async () => {
  try {
    const now = new Date();
    const season = currentEuropeanSeason(now);
    console.log("\n── Dữ liệu thật (chỉ báo, không làm đỏ cổng)");
    for (const code of ["en.1", "de.1"] as LeagueCode[]) {
      const s = await fetchLeagueSeasonMerged(code, season, now);
      const up = upcomingMatches(s.matches, code, { limit: 2 });
      const noTime = upcomingMatches(s.matches, code).filter((m) => m.kickoffVn === null).length;
      console.log(`  ${code}: ${upcomingMatches(s.matches, code).length} trận chưa đá, ${noTime} trận KHÔNG có giờ`);
      for (const m of up) console.log(`     ${m.sourceDate} ${m.sourceTime} (giải) -> ${m.kickoffVn} (VN)  ${m.home} - ${m.away}`);
    }
  } catch (e) {
    console.log(`  (bỏ qua — không đọc được nguồn: ${e instanceof Error ? e.message : e})`);
  }
  console.log("\n✓ verify:fixture-schedule — quy đổi giờ đứng vững ở cả hai phía ranh giới DST.\n");
})();
