/**
 * Cổng canh nguồn openfootball.
 *
 * Kiểm bằng BẤT BIẾN CỦA MÔN BÓNG ĐÁ, không chỉ "JSON đọc được". Một nguồn
 * hỏng vẫn trả JSON hợp lệ — TheSportsDB trả đúng hình dạng khi tôi hỏi
 * V.League 1 và đưa về Wigan Athletic, Blackpool, Leicester City. Hình dạng
 * đúng không chứng minh nội dung đúng.
 *
 * Bốn bất biến, mỗi cái bắt một cách hỏng khác nhau:
 *
 *   số trận = n(n-1)         giải vòng tròn hai lượt. Sai số này nghĩa là
 *                            thiếu trận hoặc thừa đội.
 *   mỗi đội đá 2(n-1) trận   bắt ca một đội bị chép tên hai kiểu ("Liverpool"
 *                            và "Liverpool FC" thành hai đội, mỗi đội nửa lịch)
 *   tổng bàn thắng cân       bảng tính từ trận: tổng ghi = tổng thủng
 *   tổng điểm khớp kết quả   3 điểm mỗi trận có thắng thua, 2 mỗi trận hoà
 */
import { fetchLeagueSeason, buildStandings, LEAGUES, type LeagueCode } from "../lib/football/openfootball";

const SEASON = process.argv[2] ?? "2026-27";
let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`    ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

async function main() {
  const now = new Date();
  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeason(code, SEASON, now);
    const n = s.teams.length;
    console.log(
      `\n  ${LEAGUES[code]} (${code}) — ${n} đội, ${s.matches.length} trận, ${s.played} đã đá` +
        (s.stalenessDays === null ? ", chưa có kết quả nào" : `, kết quả mới nhất ${s.lastResultDate} (${s.stalenessDays} ngày trước)`)
    );

    check(n >= 18 && n <= 20, `số đội hợp lý (${n})`);
    check(s.matches.length === n * (n - 1), `số trận = n(n-1) = ${n * (n - 1)} (đo ${s.matches.length})`);

    const per = new Map<string, number>();
    for (const m of s.matches) {
      per.set(m.home, (per.get(m.home) ?? 0) + 1);
      per.set(m.away, (per.get(m.away) ?? 0) + 1);
    }
    const wrong = [...per.entries()].filter(([, c]) => c !== 2 * (n - 1));
    check(wrong.length === 0, `mỗi đội có đúng ${2 * (n - 1)} trận${wrong.length ? ` — lệch: ${wrong.slice(0, 3).map(([t, c]) => `${t}=${c}`).join(", ")}` : ""}`);

    const table = buildStandings(s);
    const gf = table.reduce((x, r) => x + r.goalsFor, 0);
    const ga = table.reduce((x, r) => x + r.goalsAgainst, 0);
    check(gf === ga, `tổng bàn thắng = tổng bàn thua (${gf} / ${ga})`);

    const decided = s.matches.filter((m) => m.fullTime && m.fullTime[0] !== m.fullTime[1]).length;
    const drawn = s.matches.filter((m) => m.fullTime && m.fullTime[0] === m.fullTime[1]).length;
    const points = table.reduce((x, r) => x + r.points, 0);
    check(points === decided * 3 + drawn * 2, `tổng điểm khớp kết quả (${points} = ${decided}×3 + ${drawn}×2)`);

    /**
     * Trận ĐÃ đá mà không có tỷ số hiệp một thì PHẢI là trận không có bàn nào.
     *
     * Đây là luật rút ra từ dữ liệu, không phải giả định: openfootball suy tỷ
     * số hiệp một từ phút ghi bàn, nên chỉ trận 0-0 mới thiếu nó. Một trận
     * 3-1 mà thiếu tỷ số hiệp một nghĩa là quy tắc đã đổi — và lúc đó
     * `halfTime: null` của tôi đang che một thứ khác hẳn.
     */
    const noHt = s.matches.filter((m) => m.fullTime && !m.halfTime);
    const badNoHt = noHt.filter((m) => m.fullTime![0] !== 0 || m.fullTime![1] !== 0);
    check(
      badNoHt.length === 0,
      `trận thiếu tỷ số hiệp 1 đều là 0-0 (${noHt.length} trận thiếu${badNoHt.length ? `, SAI: ${badNoHt.map((m) => `${m.home} ${m.fullTime!.join("-")} ${m.away}`).slice(0, 2).join("; ")}` : ""})`
    );

    // Độ trễ KHÔNG làm cổng đỏ — nó là sự thật về nguồn, không phải lỗi. Nhưng
    // nó phải hiện ra, vì một site kết quả bóng đá trễ một tuần là hỏng dù mọi
    // phép kiểm đều xanh.
    if (s.stalenessDays !== null && s.stalenessDays > 5) {
      console.log(`    ! kết quả mới nhất đã ${s.stalenessDays} ngày — nguồn có thể đang chậm`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed} bất biến bị vi phạm.`);
    process.exit(1);
  }
  console.log("\n✓ mọi giải: số trận, lịch mỗi đội, bàn thắng và điểm đều tự khớp.");
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
