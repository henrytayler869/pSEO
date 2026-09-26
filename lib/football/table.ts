/**
 * Bảng xếp hạng và kết quả đã đá — HÌNH DẠNG DỮ LIỆU THỨ BA.
 *
 * Sau `FootballFact` (một con số kèm nhãn) và `UpcomingMatch` (một trận chưa
 * đá), đây là hai hình dạng còn lại mà một trang bóng đá cần: một BẢNG nhiều
 * dòng nhiều cột, và một DANH SÁCH trận đã có tỷ số.
 *
 * ═══ VÌ SAO KHÔNG PHẢI FACT ═══
 *
 * Cùng lý lẽ với `fixtures.ts`: nhét bảng 18 dòng vào mô hình fact sẽ phải
 * bịa ra `row_1_team`, `row_1_points`… và `requires` của đặc tả sẽ không còn
 * nói được mục này cần gì. Bảng là bảng.
 *
 * ═══ VÀ VÌ SAO NÓ KHÔNG ĐI VÀO PROMPT ═══
 *
 * Cùng ba lý do mà `upcoming` không đi: model chỉ được trích số từ
 * `modelFacts`, mọi con số ngoài tập đó sẽ bị validator từ chối là
 * `unsupported_number`; và fingerprint đổi mỗi vòng đấu thì mỗi vòng đấu sinh
 * lại toàn bộ văn. Bảng ở đây phục vụ MẮT người đọc, không phục vụ model.
 *
 * ═══ KHÔNG BIẾT GÌ VỀ NEXT ═══
 *
 * File này nằm trong `lib/football/` nên nó chịu ràng buộc của cả thư mục:
 * bốn script `verify:*` nạp tầng này bằng `tsx` thuần. Xem AGENTS.md.
 */
import type { FootballMatch, LeagueSeason } from "./openfootball";
import { buildStandings } from "./openfootball";
import { outcomeFor, playedMatches, type Outcome } from "./facts";
import { formatVn, vnInstantOf } from "./fixtures";
import { teamDisplayName } from "./team-display-names";
import { teamSlug } from "../page-axis/axes";

/** Số trận gần nhất mà cột phong độ mang theo. Năm là quy ước của mọi bảng
 *  xếp hạng bóng đá; đổi số này là đổi thứ người đọc quen nhìn. */
export const FORM_LENGTH = 5;

/** Trần của TẦNG VẬN CHUYỂN cho danh sách kết quả, không phải của trang. */
export const RESULTS_CAP = 12;

export interface TableRow {
  /** 1 là dẫn đầu. Tính từ thứ tự `buildStandings` trả về. */
  position: number;
  /** Tên HIỂN THỊ. Tên nguồn ở lại `slug` — xem chú thích bên dưới. */
  team: string;
  /** Khoá trang của đội, để publisher dựng liên kết mà không phải tự slug
   *  hoá tên. Slug sinh từ tên NGUỒN, đúng như `sync-football-entities` đã
   *  sinh khoá thực thể — slug hoá tên hiển thị sẽ ra "bayern-munich" trong
   *  khi trang thật là "fc-bayern-munchen". */
  slug: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  /** Hiệu số, tính sẵn: nó là cột người ta đọc, không phải phép trừ người ta
   *  làm trong đầu. */
  goalDiff: number;
  points: number;
  /** Tối đa `FORM_LENGTH` kết quả gần nhất, CŨ TRƯỚC MỚI SAU — cùng thứ tự
   *  với `TeamStats.form`, và cùng thứ tự mà mọi bảng bóng đá in ra. */
  form: Outcome[];
}

export interface ResultRow {
  /** Ngày của nguồn, ISO. Luôn có. */
  date: string;
  /** Ngày theo giờ Việt Nam, null khi nguồn không ghi giờ — một trận 21:00 ở
   *  Tây Ban Nha rơi sang ngày hôm sau ở Việt Nam, nên hai trường này KHÁC
   *  nhau và trang phải in cái thứ hai khi có. */
  dateVn: string | null;
  round: string;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  /** Tỷ số chung cuộc. Trận chưa đá không bao giờ lọt vào danh sách này. */
  score: [number, number];
  /** null = ĐÃ đá nhưng nguồn không ghi tỷ số hiệp một. KHÔNG phải 0-0. */
  halfTime: [number, number] | null;
}

/** Kết quả N trận gần nhất của một đội, cũ trước mới sau. */
function formOf(matches: readonly FootballMatch[], team: string): Outcome[] {
  return playedMatches(matches)
    .filter((m) => m.home === team || m.away === team)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-FORM_LENGTH)
    .map((m) => outcomeFor(m, team))
    .filter((o): o is Outcome => o !== null);
}

/**
 * Bảng xếp hạng đầy đủ của một mùa, kèm cột phong độ.
 *
 * `buildStandings` đã là nơi DUY NHẤT tính bảng — hàm này chỉ mặc quần áo
 * cho nó: thứ hạng, tên hiển thị, khoá trang, hiệu số, phong độ. Tính lại
 * điểm ở đây sẽ là nơi thứ hai trả lời cùng một câu hỏi, và hai nơi đó sẽ
 * lệch đúng vào ngày ai đó đổi luật tính điểm của một giải.
 */
export function leagueTable(season: LeagueSeason): TableRow[] {
  return buildStandings(season).map((r, i) => ({
    position: i + 1,
    team: teamDisplayName(r.team),
    slug: teamSlug(r.team),
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDiff: r.goalsFor - r.goalsAgainst,
    points: r.points,
    form: formOf(season.matches, r.team),
  }));
}

function toResult(match: FootballMatch, leagueCode: string): ResultRow {
  const at = vnInstantOf(match, leagueCode);
  return {
    date: match.date,
    dateVn: at ? formatVn(at, { day: "2-digit", month: "2-digit", year: "numeric" }) : null,
    round: match.round,
    // Tên HIỂN THỊ, cùng luật với `toUpcoming`: trang có H1 "MU" mà danh sách
    // kết quả in "Manchester United FC" là cùng một đội mang hai tên trên một
    // trang — sự cố đã xảy ra thật ngày 25/9/2026 ở danh sách lịch thi đấu.
    home: teamDisplayName(match.home),
    away: teamDisplayName(match.away),
    homeSlug: teamSlug(match.home),
    awaySlug: teamSlug(match.away),
    score: match.fullTime!,
    halfTime: match.halfTime,
  };
}

/**
 * Trận ĐÃ có tỷ số, MỚI NHẤT TRƯỚC.
 *
 * Ngược thứ tự với `upcomingMatches`, và có chủ ý: người đọc lịch muốn biết
 * trận tới, người đọc kết quả muốn biết trận vừa rồi. Hai danh sách đọc theo
 * hai chiều nên cả hai đều mở đầu bằng thứ gần hiện tại nhất.
 *
 * `opts.team` và `opts.opponent` nhận tên NGUỒN — chúng so khớp với dữ liệu
 * nguồn, giống `upcomingMatches`. Truyền tên hiển thị vào đây sẽ lọc ra rỗng
 * mà không báo lỗi gì.
 */
export function recentResults(
  matches: readonly FootballMatch[],
  leagueCode: string,
  opts: { team?: string; opponent?: string; limit?: number } = {}
): ResultRow[] {
  const rows = playedMatches(matches)
    .filter((m) => (opts.team ? m.home === opts.team || m.away === opts.team : true))
    .filter((m) => (opts.opponent ? m.home === opts.opponent || m.away === opts.opponent : true))
    .sort((a, b) =>
      a.date === b.date ? (b.time ?? "").localeCompare(a.time ?? "") : b.date.localeCompare(a.date)
    )
    .map((m) => toResult(m, leagueCode));
  return opts.limit === undefined ? rows : rows.slice(0, opts.limit);
}
