/**
 * Cổng canh tầng chỉ số bóng đá.
 *
 * ═══ NÓ SO VỚI CÁI GÌ ═══
 *
 * Bài học chung của ba cái bẫy ở brief mục 6: cổng canh phải so dữ liệu với
 * THỰC TẾ, không chỉ so với chính nó. Ở đây "thực tế" là `buildStandings()` —
 * một phép cộng ĐỘC LẬP trên cùng tập trận, đã có cổng canh riêng
 * (`verify:openfootball`) và đã chạy trên production. `teamStats()` cộng theo
 * đường khác (duyệt trận của từng đội, tách sân nhà/khách rồi gộp lại). Hai
 * đường phải ra cùng một số cho MỌI đội; lệch một đội là lệch thật.
 *
 * Đó là phép kiểm mạnh hơn hẳn việc tự so mình với mình, và nó bắt được đúng
 * loại lỗi đã xảy ra hai lần trong kho này: số đúng, gán sai chỗ.
 *
 * ═══ KIỂM CẢ MẪU SỐ CỦA CHỈ SỐ THEO HIỆP ═══
 *
 * `halfTime: null` là "không biết", không phải 0-0. Cổng này đếm số trận
 * thiếu hiệp một và khẳng định bàn hiệp một cộng hiệp hai bằng đúng tổng bàn
 * CỦA RIÊNG những trận biết hiệp một — nếu code lỡ điền 0 cho ca không biết,
 * đẳng thức này vỡ.
 *
 *     npm run verify:football-facts
 */
import { LEAGUES, buildStandings, fetchLeagueSeasonMerged, type LeagueCode } from "@/lib/football/openfootball";
import { currentEuropeanSeason } from "@/lib/football/season";
import {
  fixtureFacts, fixtureStats, leagueStats, matchesOf, playedMatches, teamFacts, teamStats,
} from "@/lib/football/facts";
import { FORM_LENGTH, leagueTable, recentResults } from "@/lib/football/table";
import { upcomingMatches } from "@/lib/football/fixtures";
import { teamDisplayName } from "@/lib/football/team-display-names";

let failures = 0;
const fail = (msg: string) => { console.error(`  ✗ ${msg}`); failures++; };
const eq = (got: number, want: number, what: string) => { if (got !== want) fail(`${what}: ${got} != ${want}`); };

async function main(): Promise<void> {
  const now = new Date();
  const season = currentEuropeanSeason(now);
  console.log(`Mùa ${season}, đo ${now.toISOString().slice(0, 10)}\n`);

  for (const code of Object.keys(LEAGUES) as LeagueCode[]) {
    const s = await fetchLeagueSeasonMerged(code, season, now);
    const table = buildStandings(s);
    const lg = leagueStats(s);

    // ── Đối chiếu chéo với buildStandings, từng đội ────────────────────────
    for (const row of table) {
      const st = teamStats(s, row.team);
      const o = st.overall;
      eq(o.played, row.played, `${code} ${row.team} số trận`);
      eq(o.won, row.won, `${code} ${row.team} thắng`);
      eq(o.drawn, row.drawn, `${code} ${row.team} hoà`);
      eq(o.lost, row.lost, `${code} ${row.team} thua`);
      eq(o.goalsFor, row.goalsFor, `${code} ${row.team} bàn thắng`);
      eq(o.goalsAgainst, row.goalsAgainst, `${code} ${row.team} bàn thua`);
      eq(o.points, row.points, `${code} ${row.team} điểm`);

      // Tách sân nhà/khách phải gộp lại đúng bằng tổng.
      eq(st.home.played + st.away.played, o.played, `${code} ${row.team} nhà+khách = tổng trận`);
      eq(st.home.points + st.away.points, o.points, `${code} ${row.team} nhà+khách = tổng điểm`);
      eq(st.home.goalsFor + st.away.goalsFor, o.goalsFor, `${code} ${row.team} nhà+khách = tổng bàn`);

      // Mẫu số của chỉ số theo hiệp.
      const mine = matchesOf(s.matches, row.team);
      const withHalf = mine.filter((m) => m.halfTime);
      eq(st.knownHalves, withHalf.length, `${code} ${row.team} số trận biết hiệp một`);
      const goalsInKnown = withHalf.reduce((sum, m) => {
        const [h, a] = m.fullTime!;
        return sum + (m.home === row.team ? h : a);
      }, 0);
      eq(
        st.firstHalfGoalsFor + st.secondHalfGoalsFor,
        goalsInKnown,
        `${code} ${row.team} hiệp một + hiệp hai = bàn trong các trận BIẾT hiệp một`
      );

      // Chỉ số không có mẫu số thì KHÔNG được phát ra.
      const facts = teamFacts(st, lg);
      if (st.knownHalves === 0 && facts.some((f) => f.key.includes("half"))) {
        fail(`${code} ${row.team}: phát chỉ số theo hiệp trong khi knownHalves = 0`);
      }
      if (o.played === 0 && facts.length > 0) {
        fail(`${code} ${row.team}: chưa đá trận nào mà vẫn phát ${facts.length} fact`);
      }
      for (const f of facts) {
        if (!Number.isFinite(f.value)) fail(`${code} ${row.team}: fact ${f.key} có value không hữu hạn`);
        if (f.display.trim() === "") fail(`${code} ${row.team}: fact ${f.key} có display rỗng`);
      }
    }

    // ── Cấp giải: tổng phải khớp ───────────────────────────────────────────
    const played = playedMatches(s.matches);
    eq(lg.played, played.length, `${code} số trận đã đá`);
    eq(lg.homeWins + lg.draws + lg.awayWins, lg.played, `${code} thắng/hoà/thua chủ nhà = tổng trận`);
    eq(
      table.reduce((n, r) => n + r.goalsFor, 0),
      lg.goals,
      `${code} tổng bàn theo bảng = tổng bàn theo trận`
    );
    const missingHalf = played.length - lg.knownHalves;

    /**
     * ── Bảng xếp hạng vận chuyển: cùng thứ tự, cùng số, và CỘT PHONG ĐỘ
     *    phải khớp bảng ────────────────────────────────────────────────────
     *
     * `leagueTable` mặc quần áo cho `buildStandings`, nên hai thứ phải trùng
     * từng dòng. Phép kiểm đáng giá là cột `form`: nó đếm theo đường KHÁC —
     * duyệt trận của từng đội rồi chấm thắng/hoà/thua — nên khi đội mới đá
     * không quá `FORM_LENGTH` trận, số T/H/B trong phong độ phải bằng đúng
     * cột thắng/hoà/thua của bảng. Lệch nghĩa là một trong hai đường sai.
     */
    const rows = leagueTable(s);
    eq(rows.length, table.length, `${code} số dòng bảng vận chuyển`);
    for (const [i, r] of rows.entries()) {
      eq(r.position, i + 1, `${code} ${r.team} thứ hạng`);
      eq(r.points, table[i].points, `${code} ${r.team} điểm bảng vận chuyển`);
      eq(r.goalDiff, table[i].goalsFor - table[i].goalsAgainst, `${code} ${r.team} hiệu số`);
      if (r.slug === "") fail(`${code} ${r.team}: slug rỗng — liên kết bảng sẽ trỏ vào chính trang đang xem`);
      if (r.form.length > FORM_LENGTH) fail(`${code} ${r.team}: phong độ ${r.form.length} trận, trần là ${FORM_LENGTH}`);
      if (r.played <= FORM_LENGTH) {
        eq(r.form.filter((o) => o === "T").length, r.won, `${code} ${r.team} phong độ thắng`);
        eq(r.form.filter((o) => o === "H").length, r.drawn, `${code} ${r.team} phong độ hoà`);
        eq(r.form.filter((o) => o === "B").length, r.lost, `${code} ${r.team} phong độ thua`);
      }

      // Kết quả của đội: đếm phải bằng số trận đã đá, và thứ tự MỚI TRƯỚC.
      const res = recentResults(s.matches, code, { team: table[i].team });
      eq(res.length, r.played, `${code} ${r.team} số dòng kết quả`);
      for (let k = 1; k < res.length; k++) {
        if (res[k - 1].date < res[k].date) fail(`${code} ${r.team}: kết quả không theo thứ tự mới trước`);
      }
    }

    // ── Cặp đối đầu: tổng phải khớp ────────────────────────────────────────
    let pairsWithMeetings = 0;
    for (let i = 0; i < s.teams.length; i++) {
      for (let j = i + 1; j < s.teams.length; j++) {
        const fx = fixtureStats(s, s.teams[i], s.teams[j]);
        if (fx.meetings.length === 0) {
          if (fixtureFacts(fx, lg).length > 0) fail(`${code} ${s.teams[i]}/${s.teams[j]}: chưa gặp nhau mà vẫn phát fact`);
          continue;
        }
        pairsWithMeetings++;
        eq(fx.winsA + fx.winsB + fx.draws, fx.meetings.length, `${code} ${s.teams[i]}/${s.teams[j]} kết quả = số trận`);
        eq(
          recentResults(s.matches, code, { team: s.teams[i], opponent: s.teams[j] }).length,
          fx.meetings.length,
          `${code} ${s.teams[i]}/${s.teams[j]} số dòng kết quả đối đầu`
        );
      }
    }

    /**
     * ── Lịch thi đấu của trang CẶP: lọc theo tên HIỂN THỊ phải ra đúng số
     *    trận mà nguồn nói ──────────────────────────────────────────────────
     *
     * Hồi quy cho lỗi đo 26/9/2026: `buildEntityFactSet` lọc danh sách đã quy
     * về tên hiển thị bằng tên NGUỒN, nên mục lịch biến mất khỏi 119/876 trang
     * cặp — 203 dòng trận. Không cổng nào đỏ vì một danh sách rỗng là câu trả
     * lời hợp lệ khi mùa đã đá hết.
     *
     * Phép kiểm so hai đường: đếm thẳng trên tên nguồn, và đếm qua đường mà
     * trang thật đi (quy đổi tên rồi lọc).
     */
    for (let i = 0; i < s.teams.length; i++) {
      for (let j = i + 1; j < s.teams.length; j++) {
        const [A, B] = [s.teams[i], s.teams[j]];
        const raw = s.matches.filter(
          (m) => m.fullTime === null && ((m.home === A && m.away === B) || (m.home === B && m.away === A))
        ).length;
        const shown = teamDisplayName(B);
        const shipped = upcomingMatches(s.matches, code, { team: A }).filter(
          (m) => m.home === shown || m.away === shown
        ).length;
        eq(shipped, raw, `${code} ${A}/${B} số trận chưa đá của trang cặp`);
      }
    }

    if (s.conflicts.length > 0) {
      // Hai nguồn khai hai tỷ số khác nhau. KHÔNG phủ im lặng — xem
      // fetchLeagueSeasonMerged. Một xung đột là bằng chứng ít nhất một bên sai.
      for (const c of s.conflicts) {
        fail(`${code} ${c.home} vs ${c.away}: JSON ${c.base.join("-")} còn .txt ${c.overlay.join("-")}`);
      }
    }
    if (s.unmatched.length > 0) {
      fail(`${code}: ${s.unmatched.length} cặp trong .txt không khớp nền — tên đội lệch giữa hai bản`);
    }

    console.log(
      `${code.padEnd(5)} ${String(lg.played).padStart(3)}/${lg.scheduled} trận  ` +
        `trên 2,5: ${lg.over25}  hai đội ghi: ${lg.bothScored}  chủ nhà thắng: ${lg.homeWins}  ` +
        `ngược dòng: ${lg.comebackWins}  rơi dẫn: ${lg.droppedLeads}  thiếu hiệp một: ${missingHalf}  cặp đã gặp: ${pairsWithMeetings}`
    );
    console.log(
      `      dẫn đầu: ${lg.leader?.team ?? "—"} ${lg.leader?.points ?? 0}đ ` +
        `(${lg.leader?.won ?? 0}-${lg.leader?.drawn ?? 0}-${lg.leader?.lost ?? 0})  trễ ${lg.stalenessDays ?? "?"} ngày`
    );
  }

  console.log("");
  if (failures > 0) {
    console.error(`ĐỎ — ${failures} vấn đề.`);
    process.exit(1);
  }
  console.log("XANH — tầng chỉ số khớp buildStandings trên mọi đội của cả 5 giải.");
}

main().catch((err) => { console.error(err); process.exit(1); });
