/**
 * Chỉ số cấp ĐỘI, cấp GIẢI và cấp CẶP ĐỐI ĐẦU, suy từ kết quả trận.
 *
 * ═══ FILE NÀY CHỊU CÙNG RÀNG BUỘC "KHÔNG BIẾT GÌ VỀ NEXT" ═══
 *
 * `scripts/verify-page-axis.ts` và `scripts/verify-football-facts.ts` nạp nó
 * bằng `tsx` thuần. Thêm một import của Next vào đây đánh sập cả hai, và
 * thông báo lỗi lúc ấy (`ERR_REQUIRE_ASYNC_MODULE`) không nhắc một chữ nào
 * về caching — xem AGENTS.md mục "lib/football phải KHÔNG BIẾT GÌ về Next".
 * Chỗ duy nhất được phép biết Next vẫn là `cached.ts`.
 *
 * ═══ KHÔNG CÓ DỮ LIỆU CẦU THỦ, VÀ ĐÓ LÀ LẰN RANH ═══
 *
 * Nguồn chỉ có: vòng, ngày, hai đội, tỷ số hiệp một và chung cuộc. KHÔNG có
 * người ghi bàn, đội hình, phút thi đấu, thẻ phạt, số cú sút (brief mục 3.1).
 * Mọi chỉ số ở file này suy được từ bốn thứ kia bằng phép cộng. Thêm bất cứ
 * chỉ số nào không suy được từ đó là bịa số, và kho này có nguyên một tầng
 * validator tồn tại vì đúng cám dỗ ấy.
 *
 * ═══ `halfTime: null` LÀ "KHÔNG BIẾT", KHÔNG PHẢI 0-0 ═══
 *
 * Đo 22/9/2026: 224/241 trận đã đá biết tỷ số hiệp một; 17 trận thiếu ĐỀU là
 * trận 0-0, vì nguồn suy hiệp một từ phút ghi bàn nên trận không bàn nào thì
 * không suy được.
 *
 * Điền 0 vào đó là cách nhanh nhất để có một con số sai mà trông đúng — và
 * sai LỆCH MỘT CHIỀU, vì mọi ca thiếu đều là 0-0. Nên mọi chỉ số theo hiệp ở
 * đây mang theo MẪU SỐ của chính nó (`knownHalves`), và chỉ số có mẫu số 0
 * KHÔNG được phát ra. Một mục không render đọc ra là "không có", còn một số 0
 * đọc ra là "đã đo, bằng không".
 */
import type { FootballMatch, LeagueSeason, StandingRow } from "./openfootball";
import { LEAGUES, buildStandings } from "./openfootball";
import { FIXTURE_SEPARATOR, teamDisplayName } from "./team-display-names";

/**
 * Phạm vi của một con số. Cùng vai trò với `Fact["scope"]` của trục địa lý,
 * và cùng lý do tồn tại: luật `aggregate-must-declare-scope` cấm trình bày
 * một con số cấp giải như thể nó là số của một đội. "52% số trận có trên 2,5
 * bàn" là số của GIẢI; viết nó vào trang Arsenal mà không nói rõ là sai phạm
 * vi, y hệt việc gán một con số cấp hạt cho một ZIP.
 */
export type FootballScope = "TEAM" | "LEAGUE" | "FIXTURE";

export interface FootballFact {
  key: string;
  label: string;
  value: number;
  /** Chuỗi trang in ra NGUYÊN VĂN, và chuỗi prompt đưa cho model.
   *  Một chỗ định dạng duy nhất: hai nơi định dạng một con số là hai câu trả
   *  lời cho một câu hỏi. */
  display: string;
  unit: string;
  scope: FootballScope;
  /** Tên thứ mà con số thật sự mô tả — tên đội, tên giải, hoặc "A gặp B". */
  scopeName: string;
}

export type Outcome = "T" | "H" | "B";

/**
 * Tên giải NGƯỜI VIỆT ĐỌC, không phải tên trong file nguồn.
 *
 * `LeagueStats.name` là chuỗi openfootball in ra — "English Premier League
 * 2026/27". Site này viết tiếng Việt, và tên giải đi thẳng vào NHÃN chỉ số,
 * vào `scopeName`, rồi vào prompt. Luật 2 của validator buộc model nêu tên
 * giải mỗi khi dùng một con số cấp giải, nên dùng tên nguồn nghĩa là mỗi đoạn
 * văn tiếng Việt sẽ có một cụm tiếng Anh kẹp giữa — trên MỌI trang đội.
 *
 * Rơi về tên nguồn khi mã giải lạ: thà một tên tiếng Anh còn hơn một ô trống,
 * và mã lạ thì `verify:page-axis` đã bắt ở chỗ khác.
 */
function leagueLabel(lg: LeagueStats): string {
  return (LEAGUES as Record<string, string>)[lg.code] ?? lg.name;
}

const pct = (n: number, d: number): number => (d === 0 ? 0 : (n / d) * 100);
const showPct = (v: number): string => `${v.toFixed(1).replace(".", ",")}%`;
const showInt = (v: number): string => String(v);

/** Trận đã đá, tức có tỷ số chung cuộc. Chưa đá thì `fullTime` là null. */
export function playedMatches(matches: readonly FootballMatch[]): FootballMatch[] {
  return matches.filter((m) => m.fullTime !== null);
}

/** Trận của MỘT đội, theo thứ tự ngày tăng dần. */
export function matchesOf(matches: readonly FootballMatch[], team: string): FootballMatch[] {
  return playedMatches(matches)
    .filter((m) => m.home === team || m.away === team)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function outcomeFor(match: FootballMatch, team: string): Outcome | null {
  if (!match.fullTime) return null;
  const [h, a] = match.fullTime;
  const isHome = match.home === team;
  const scored = isHome ? h : a;
  const conceded = isHome ? a : h;
  if (scored > conceded) return "T";
  if (scored < conceded) return "B";
  return "H";
}

export interface TeamSplit {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  cleanSheets: number;
  failedToScore: number;
}

const emptySplit = (): TeamSplit => ({
  played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0,
  points: 0, cleanSheets: 0, failedToScore: 0,
});

function accumulate(split: TeamSplit, scored: number, conceded: number): void {
  split.played++;
  split.goalsFor += scored;
  split.goalsAgainst += conceded;
  if (scored > conceded) { split.won++; split.points += 3; }
  else if (scored === conceded) { split.drawn++; split.points += 1; }
  else { split.lost++; }
  if (conceded === 0) split.cleanSheets++;
  if (scored === 0) split.failedToScore++;
}

export interface TeamStats {
  team: string;
  /** Vị trí trên bảng, 1 là dẫn đầu. */
  position: number;
  totalTeams: number;
  overall: TeamSplit;
  home: TeamSplit;
  away: TeamSplit;
  /** Kết quả N trận gần nhất, CŨ TRƯỚC MỚI SAU. */
  form: Outcome[];
  /** Chuỗi hiện tại: loại và độ dài. `length` 0 khi chưa đá trận nào. */
  streak: { kind: "thắng" | "bất bại" | "không thắng" | "thua"; length: number } | null;
  /** Số trận của đội này có TRÊN 2,5 bàn, và số trận cả hai đội cùng ghi. */
  over25: number;
  bothScored: number;
  /**
   * Bàn theo hiệp — và `knownHalves` là mẫu số của CHÍNH hai con số này.
   * `knownHalves === 0` nghĩa là không biết gì, không phải "không ghi bàn nào".
   */
  knownHalves: number;
  firstHalfGoalsFor: number;
  secondHalfGoalsFor: number;
}

export function teamStats(season: LeagueSeason, team: string, formWindow = 5): TeamStats {
  const table = buildStandings(season);
  const position = table.findIndex((r) => r.team === team) + 1;
  const mine = matchesOf(season.matches, team);

  const overall = emptySplit();
  const home = emptySplit();
  const away = emptySplit();
  let over25 = 0;
  let bothScored = 0;
  let knownHalves = 0;
  let firstHalfGoalsFor = 0;
  let secondHalfGoalsFor = 0;

  for (const m of mine) {
    const [h, a] = m.fullTime!;
    const isHome = m.home === team;
    const scored = isHome ? h : a;
    const conceded = isHome ? a : h;
    accumulate(overall, scored, conceded);
    accumulate(isHome ? home : away, scored, conceded);
    if (h + a > 2.5) over25++;
    if (h > 0 && a > 0) bothScored++;

    // Chỉ cộng khi BIẾT hiệp một. Xem khối đầu file.
    if (m.halfTime) {
      knownHalves++;
      const htFor = isHome ? m.halfTime[0] : m.halfTime[1];
      firstHalfGoalsFor += htFor;
      secondHalfGoalsFor += scored - htFor;
    }
  }

  const form = mine.slice(-formWindow).map((m) => outcomeFor(m, team)!).filter(Boolean);

  return {
    team,
    position,
    totalTeams: table.length,
    overall, home, away, form,
    streak: currentStreak(mine.map((m) => outcomeFor(m, team)!)),
    over25, bothScored,
    knownHalves, firstHalfGoalsFor, secondHalfGoalsFor,
  };
}

/**
 * Chuỗi hiện tại, tính từ trận gần nhất ngược về.
 *
 * Bốn loại chứ không một: "bất bại" và "không thắng" là hai chuỗi mà người
 * đọc bóng đá thật sự đếm, và chúng KHÔNG suy ra được từ chuỗi thắng/thua —
 * một đội hoà bốn trận có chuỗi bất bại 4 và chuỗi thắng 0. Chọn loại dài
 * hơn, ưu tiên loại nói mạnh hơn khi bằng nhau.
 */
export function currentStreak(outcomes: readonly Outcome[]): TeamStats["streak"] {
  if (outcomes.length === 0) return null;
  const run = (pred: (o: Outcome) => boolean): number => {
    let n = 0;
    for (let i = outcomes.length - 1; i >= 0 && pred(outcomes[i]); i--) n++;
    return n;
  };
  const wins = run((o) => o === "T");
  const losses = run((o) => o === "B");
  const unbeaten = run((o) => o !== "B");
  const winless = run((o) => o !== "T");

  if (wins >= 2) return { kind: "thắng", length: wins };
  if (losses >= 2) return { kind: "thua", length: losses };
  if (unbeaten >= 2) return { kind: "bất bại", length: unbeaten };
  if (winless >= 2) return { kind: "không thắng", length: winless };
  // Một trận đơn lẻ không phải "chuỗi". Nói "chuỗi thắng 1 trận" là dùng một
  // từ to cho một sự kiện nhỏ, và nó sẽ xuất hiện trên rất nhiều trang.
  return null;
}

export interface LeagueStats {
  code: string;
  name: string;
  season: string;
  teams: number;
  played: number;
  scheduled: number;
  over25: number;
  bothScored: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  goals: number;
  /** Mẫu số của mọi chỉ số theo hiệp ở cấp giải. */
  knownHalves: number;
  /** Đội dẫn hiệp một rồi THUA. Đây là "lội ngược dòng" theo nghĩa người xem
   *  bóng đá dùng: đội bị dẫn lật lại và thắng. */
  comebackWins: number;
  /** Đội dẫn hiệp một rồi chỉ HOÀ. Đánh rơi chiến thắng, KHÔNG phải lội ngược
   *  dòng — gộp hai cái vào một con số là đặt một nhãn sai lên một số đúng,
   *  đúng loại lỗi mà không validator nào bắt được (brief mục 6, bẫy 2). */
  droppedLeads: number;
  leader: StandingRow | null;
  stalenessDays: number | null;
}

export function leagueStats(season: LeagueSeason): LeagueStats {
  const played = playedMatches(season.matches);
  let over25 = 0, bothScored = 0, homeWins = 0, draws = 0, awayWins = 0, goals = 0;
  let knownHalves = 0, comebackWins = 0, droppedLeads = 0;

  for (const m of played) {
    const [h, a] = m.fullTime!;
    goals += h + a;
    if (h + a > 2.5) over25++;
    if (h > 0 && a > 0) bothScored++;
    if (h > a) homeWins++;
    else if (h === a) draws++;
    else awayWins++;

    if (m.halfTime) {
      knownHalves++;
      const [hh, ha] = m.halfTime;
      const leaderAtHalf = hh > ha ? "home" : hh < ha ? "away" : null;
      const winnerAtEnd = h > a ? "home" : h < a ? "away" : null;
      if (leaderAtHalf !== null) {
        if (winnerAtEnd === null) droppedLeads++;
        else if (winnerAtEnd !== leaderAtHalf) comebackWins++;
      }
    }
  }

  const table = buildStandings(season);
  return {
    code: season.code,
    name: season.name,
    season: season.season,
    teams: season.teams.length,
    played: played.length,
    scheduled: season.matches.length,
    over25, bothScored, homeWins, draws, awayWins, goals,
    knownHalves, comebackWins, droppedLeads,
    leader: table[0] ?? null,
    stalenessDays: season.stalenessDays,
  };
}

export interface FixtureStats {
  teamA: string;
  teamB: string;
  /** Trận giữa hai đội trong tập mùa đang có, cũ trước mới sau. */
  meetings: FootballMatch[];
  winsA: number;
  winsB: number;
  draws: number;
  goalsA: number;
  goalsB: number;
}

export function fixtureStats(season: LeagueSeason, teamA: string, teamB: string): FixtureStats {
  const meetings = playedMatches(season.matches)
    .filter(
      (m) =>
        (m.home === teamA && m.away === teamB) || (m.home === teamB && m.away === teamA)
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  let winsA = 0, winsB = 0, draws = 0, goalsA = 0, goalsB = 0;
  for (const m of meetings) {
    const [h, a] = m.fullTime!;
    const aIsHome = m.home === teamA;
    const sa = aIsHome ? h : a;
    const sb = aIsHome ? a : h;
    goalsA += sa;
    goalsB += sb;
    if (sa > sb) winsA++;
    else if (sa < sb) winsB++;
    else draws++;
  }
  return { teamA, teamB, meetings, winsA, winsB, draws, goalsA, goalsB };
}

// ── Chuyển sang FootballFact cho prompt và validator ───────────────────────

/**
 * Chỉ phát ra chỉ số CÓ MẪU SỐ.
 *
 * Một đội chưa đá trận nào thì "tỷ lệ thắng sân nhà" không phải 0% — nó là
 * câu hỏi chưa trả lời được. Phát ra 0 sẽ đưa một con số sai vào fact set, và
 * validator sẽ vui vẻ chấp nhận mọi câu văn trích đúng con số sai đó: nó kiểm
 * văn bản so với fact, không kiểm fact so với thực tế (xem bẫy số 2, brief
 * mục 6).
 */
function push(out: FootballFact[], f: FootballFact | null): void {
  if (f) out.push(f);
}

export function teamFacts(stats: TeamStats, league: LeagueStats): FootballFact[] {
  const out: FootballFact[] = [];
  /**
   * Tên HIỂN THỊ, không phải tên nguồn — nhãn chỉ số vừa in lên trang vừa đi
   * vào prompt. Đo 25/9/2026: trang tiêu đề "Arsenal" in nhãn "điểm của
   * Arsenal FC", và 76/361 đoạn văn AI mở đầu bằng tên nguồn vì model chỉ
   * thấy chuỗi đó. Sửa ở đây sửa cả hai chỗ bằng một dòng.
   *
   * KHÔNG đổi `stats.team`: nó là khoá đối chiếu với nguồn. Chỉ chữ đổi.
   */
  const t = teamDisplayName(stats.team);
  const o = stats.overall;

  if (o.played === 0) return out;

  push(out, { key: "team_position", label: `vị trí của ${t} trên bảng xếp hạng`, value: stats.position, display: showInt(stats.position), unit: "hạng", scope: "TEAM", scopeName: t });
  push(out, { key: "team_points", label: `điểm của ${t}`, value: o.points, display: showInt(o.points), unit: "điểm", scope: "TEAM", scopeName: t });
  push(out, { key: "team_played", label: `số trận ${t} đã đá`, value: o.played, display: showInt(o.played), unit: "trận", scope: "TEAM", scopeName: t });
  push(out, { key: "team_won", label: `số trận ${t} thắng`, value: o.won, display: showInt(o.won), unit: "trận", scope: "TEAM", scopeName: t });
  push(out, { key: "team_drawn", label: `số trận ${t} hoà`, value: o.drawn, display: showInt(o.drawn), unit: "trận", scope: "TEAM", scopeName: t });
  push(out, { key: "team_lost", label: `số trận ${t} thua`, value: o.lost, display: showInt(o.lost), unit: "trận", scope: "TEAM", scopeName: t });
  push(out, { key: "team_goals_for", label: `số bàn ${t} ghi`, value: o.goalsFor, display: showInt(o.goalsFor), unit: "bàn", scope: "TEAM", scopeName: t });
  push(out, { key: "team_goals_against", label: `số bàn ${t} thủng lưới`, value: o.goalsAgainst, display: showInt(o.goalsAgainst), unit: "bàn", scope: "TEAM", scopeName: t });
  push(out, { key: "team_clean_sheets", label: `số trận ${t} giữ sạch lưới`, value: o.cleanSheets, display: showInt(o.cleanSheets), unit: "trận", scope: "TEAM", scopeName: t });

  if (stats.home.played > 0) {
    push(out, { key: "team_home_points", label: `điểm ${t} giành trên sân nhà`, value: stats.home.points, display: showInt(stats.home.points), unit: "điểm", scope: "TEAM", scopeName: t });
    push(out, { key: "team_home_played", label: `số trận ${t} đá trên sân nhà`, value: stats.home.played, display: showInt(stats.home.played), unit: "trận", scope: "TEAM", scopeName: t });
  }
  if (stats.away.played > 0) {
    push(out, { key: "team_away_points", label: `điểm ${t} giành trên sân khách`, value: stats.away.points, display: showInt(stats.away.points), unit: "điểm", scope: "TEAM", scopeName: t });
    push(out, { key: "team_away_played", label: `số trận ${t} đá trên sân khách`, value: stats.away.played, display: showInt(stats.away.played), unit: "trận", scope: "TEAM", scopeName: t });
  }

  // Theo hiệp: chỉ khi CÓ mẫu số, và mẫu số đi kèm như một fact riêng để câu
  // văn có thể nói "trong N trận biết tỷ số hiệp một".
  if (stats.knownHalves > 0) {
    push(out, { key: "team_known_halves", label: `số trận của ${t} biết tỷ số hiệp một`, value: stats.knownHalves, display: showInt(stats.knownHalves), unit: "trận", scope: "TEAM", scopeName: t });
    push(out, { key: "team_first_half_goals", label: `bàn ${t} ghi trong hiệp một`, value: stats.firstHalfGoalsFor, display: showInt(stats.firstHalfGoalsFor), unit: "bàn", scope: "TEAM", scopeName: t });
    push(out, { key: "team_second_half_goals", label: `bàn ${t} ghi trong hiệp hai`, value: stats.secondHalfGoalsFor, display: showInt(stats.secondHalfGoalsFor), unit: "bàn", scope: "TEAM", scopeName: t });
  }

  if (stats.streak) {
    push(out, { key: "team_streak_length", label: `chuỗi ${stats.streak.kind} hiện tại của ${t}`, value: stats.streak.length, display: showInt(stats.streak.length), unit: "trận", scope: "TEAM", scopeName: t });
  }

  // Cấp GIẢI, phát kèm để câu văn so sánh được — và mang scope LEAGUE nên bất
  // kỳ câu nào dùng nó buộc phải nói đó là số của giải.
  if (league.played > 0) {
    const lname = leagueLabel(league);
    const overRate = pct(league.over25, league.played);
    push(out, { key: "league_over25_pct", label: `tỷ lệ trận trên 2,5 bàn ở ${lname}`, value: overRate, display: showPct(overRate), unit: "%", scope: "LEAGUE", scopeName: lname });
    const homeRate = pct(league.homeWins, league.played);
    push(out, { key: "league_home_win_pct", label: `tỷ lệ chủ nhà thắng ở ${lname}`, value: homeRate, display: showPct(homeRate), unit: "%", scope: "LEAGUE", scopeName: lname });
    push(out, { key: "league_played", label: `số trận đã đá ở ${lname}`, value: league.played, display: showInt(league.played), unit: "trận", scope: "LEAGUE", scopeName: lname });
  }

  return out;
}

/**
 * Fact cho trang GIẢI.
 *
 * Phát ra ĐÚNG ba khoá mà `teamFacts` cũng phát ở phần bối cảnh, không thêm
 * khoá mới. Không phải vì trang giải không nói được gì hơn, mà vì mỗi khoá
 * mới phải có chỗ trong đặc tả hoặc trong `excluded` — `verify:entity-spec`
 * đối chiếu hai chiều và sẽ đỏ nếu tôi phát ra một chỉ số chưa ai quyết định
 * dùng hay bỏ. Thêm chỉ số cho trang giải là một thay đổi có chủ đích, đi kèm
 * một mục trong đặc tả, không phải một hệ quả phụ của việc viết hàm này.
 */
export function leagueFacts(lg: LeagueStats): FootballFact[] {
  const out: FootballFact[] = [];
  if (lg.played === 0) return out;
  const lname = leagueLabel(lg);
  const overRate = pct(lg.over25, lg.played);
  const homeRate = pct(lg.homeWins, lg.played);
  push(out, { key: "league_played", label: `số trận đã đá ở ${lname}`, value: lg.played, display: showInt(lg.played), unit: "trận", scope: "LEAGUE", scopeName: lname });
  push(out, { key: "league_over25_pct", label: `tỷ lệ trận trên 2,5 bàn ở ${lname}`, value: overRate, display: showPct(overRate), unit: "%", scope: "LEAGUE", scopeName: lname });
  push(out, { key: "league_home_win_pct", label: `tỷ lệ chủ nhà thắng ở ${lname}`, value: homeRate, display: showPct(homeRate), unit: "%", scope: "LEAGUE", scopeName: lname });
  return out;
}

export function fixtureFacts(fx: FixtureStats, league: LeagueStats): FootballFact[] {
  const out: FootballFact[] = [];
  const nameA = teamDisplayName(fx.teamA);
  const nameB = teamDisplayName(fx.teamB);
  const name = `${nameA}${FIXTURE_SEPARATOR}${nameB}`;
  const lname = leagueLabel(league);
  if (fx.meetings.length === 0) return out;

  push(out, { key: "h2h_meetings", label: `số lần ${name} đã gặp nhau trong tập dữ liệu`, value: fx.meetings.length, display: showInt(fx.meetings.length), unit: "trận", scope: "FIXTURE", scopeName: name });
  push(out, { key: "h2h_wins_a", label: `số trận ${nameA} thắng trong các lần gặp ${nameB}`, value: fx.winsA, display: showInt(fx.winsA), unit: "trận", scope: "FIXTURE", scopeName: name });
  push(out, { key: "h2h_wins_b", label: `số trận ${nameB} thắng trong các lần gặp ${nameA}`, value: fx.winsB, display: showInt(fx.winsB), unit: "trận", scope: "FIXTURE", scopeName: name });
  push(out, { key: "h2h_draws", label: `số trận hoà giữa ${nameA} và ${nameB}`, value: fx.draws, display: showInt(fx.draws), unit: "trận", scope: "FIXTURE", scopeName: name });
  push(out, { key: "h2h_goals_a", label: `bàn ${nameA} ghi trong các lần gặp ${nameB}`, value: fx.goalsA, display: showInt(fx.goalsA), unit: "bàn", scope: "FIXTURE", scopeName: name });
  push(out, { key: "h2h_goals_b", label: `bàn ${nameB} ghi trong các lần gặp ${nameA}`, value: fx.goalsB, display: showInt(fx.goalsB), unit: "bàn", scope: "FIXTURE", scopeName: name });
  push(out, { key: "league_played", label: `số trận đã đá ở ${lname}`, value: league.played, display: showInt(league.played), unit: "trận", scope: "LEAGUE", scopeName: lname });
  return out;
}
