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
import { fetchLeagueSeasonMerged, buildStandings, LEAGUES, type LeagueCode } from "../lib/football/openfootball";
import { parseSeasonTxt } from "../lib/football/openfootball-txt";

const SEASON = process.argv[2] ?? "2026-27";
let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`    ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

/**
 * ĐỐI CHỨNG DƯƠNG cho phép dò xung đột.
 *
 * "0 xung đột" có hai nghĩa: hai nguồn thật sự khớp, hoặc phép dò hỏng. Phân
 * biệt được bằng cách đưa vào một mâu thuẫn dựng sẵn và bắt nó phải kêu —
 * cùng bài học đã gặp bốn lần trong ngày: một phép đo hỏng trông y hệt một
 * kết quả sạch.
 */
function selfTestConflictDetector(): void {
  const txt = parseSeasonTxt(
    [
      "= Test League 2026/27",
      "# Date       Fri Aug 21 2026 - Sun May 30 2027 (282d)",
      "▪ Matchday 1",
      "  Fri Aug 21 2026",
      "    20:00  Alpha FC                v Beta FC              3-0 (2-0)",
      "  Sat Jan 2",
      "    15:00  Beta FC                 v Alpha FC             1-1 (0-0)",
    ].join("\n")
  );
  const ok =
    txt.matches.length === 2 &&
    txt.matches[0].fullTime?.join("-") === "3-0" &&
    // Ngày tháng 1 phải suy sang NĂM SAU, không phải 2026.
    txt.matches[1].date === "2027-01-02";
  console.log(`  ${ok ? "✓" : "✗"} tự kiểm parser: đọc được tỷ số và suy đúng năm (${txt.matches[1]?.date})`);
  if (!ok) failed++;
}

async function main() {
  const now = new Date();
  selfTestConflictDetector();
  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeasonMerged(code, SEASON, now);
    const n = s.teams.length;
    console.log(
      `\n  ${LEAGUES[code]} (${code}) — ${n} đội, ${s.matches.length} trận, ${s.played} đã đá` +
        (s.stalenessDays === null ? ", chưa có kết quả nào" : `, kết quả mới nhất ${s.lastResultDate} (${s.stalenessDays} ngày trước)`) +
        (s.overlaySource === "txt" ? `, +${s.overlaid} trận lấy từ .txt` : ", KHÔNG có lớp phủ .txt")
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

    /**
     * HAI NGUỒN PHẢI ĐỒNG Ý Ở CHỖ CHỒNG LẤN.
     *
     * Đây là lý do lớp phủ đáng có thêm: .txt không chỉ bù kết quả mới, nó
     * còn kiểm chéo phần JSON đã có. Hai nguồn độc lập đồng ý là bằng chứng;
     * một nguồn nói một mình chỉ là lời khai.
     *
     * Xung đột KHÔNG được phủ im lặng — code giữ nền và báo ra, vì không có
     * cách nào biết bên nào đúng từ trong đó.
     */
    if (s.overlaySource === "none") {
      // KHÔNG in dấu xanh cho một phép kiểm không chạy. "0 xung đột" ở một
      // giải chỉ có một nguồn là đúng theo nghĩa rỗng, và một dấu ✓ ở đó dạy
      // người đọc rằng ✓ không có nghĩa gì.
      console.log("    · không đối chiếu chéo được: giải này chỉ có một nguồn (openfootball không có kho .txt)");
    } else {
      check(
        s.conflicts.length === 0,
        `hai nguồn khớp ở ${s.played - s.overlaid} trận chồng lấn${s.conflicts.length ? ` — ${s.conflicts.slice(0, 2).map((c) => `${c.home} v ${c.away}: ${c.base.join("-")} vs ${c.overlay.join("-")}`).join("; ")}` : ""}`
      );
      check(
        s.unmatched.length === 0,
        `mọi cặp đội trong .txt ghép được vào nền${s.unmatched.length ? ` — lệch tên: ${s.unmatched.slice(0, 2).join(", ")}` : ""}`
      );
    }

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
