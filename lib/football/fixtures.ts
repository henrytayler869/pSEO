/**
 * Lịch thi đấu — trận CHƯA đá, quy về giờ Việt Nam.
 *
 * ═══ VÌ SAO LÀ MỘT MODULE RIÊNG, KHÔNG PHẢI THÊM FACT ═══
 *
 * `FootballFact` là một CON SỐ kèm nhãn: `{ value, display, unit, scope }`.
 * Lịch thi đấu không phải con số — nó là một DANH SÁCH trận, mỗi trận có
 * ngày, giờ, vòng, hai đội. Nhét nó vào mô hình fact sẽ phải bịa ra những
 * khoá kiểu `next_match_1_home`, và đặc tả `requires` sẽ không còn nói được
 * mục này cần gì.
 *
 * Nên lịch là một hình dạng dữ liệu THỨ HAI bên cạnh fact, và
 * `EntitySection.kind` phân biệt hai loại mục đọc hai hình dạng đó.
 *
 * ═══ VÌ SAO MÚI GIỜ LÀ PHẦN NGUY HIỂM NHẤT FILE NÀY ═══
 *
 * openfootball ghi giờ **ĐỊA PHƯƠNG CỦA GIẢI**, không phải UTC. Đo
 * 24/9/2026 trên mùa 2026-27, khung giờ hay gặp nhất của từng giải:
 *
 *     en.1  15:00   (thứ Bảy 3 giờ chiều — khung Anh kinh điển)
 *     de.1  15:30   (khung Bundesliga kinh điển)
 *     it.1  20:45   (khung Serie A kinh điển)
 *     es.1  21:00   (khung La Liga muộn)
 *
 * Bốn giải rơi đúng vào tập quán riêng của bốn nước. Nếu chuỗi này là UTC
 * thì chúng đã lệch khỏi tập quán ấy — nên đây là phép đo bác bỏ được giả
 * thuyết "giờ là UTC", chứ không phải một suy đoán.
 *
 * Hệ quả: quy đổi phải đi qua múi giờ IANA của TỪNG giải, và phải để thư
 * viện xử lý DST. Anh đổi giờ cuối tháng 10, lục địa đổi ngày khác — nên
 * "cộng 6 tiếng" đúng nửa năm và sai nửa còn lại, mỗi lần sai đúng MỘT
 * tiếng. Một tiếng thì không ai nhìn ra khi đọc trang; nó chỉ lộ khi có
 * người bật TV và trận đã đá xong.
 *
 * File này KHÔNG import Next — cùng ràng buộc với phần còn lại của
 * `lib/football/`, xem AGENTS.md.
 */
import type { FootballMatch } from "./openfootball";

/** Múi giờ IANA của từng giải. Dùng IANA chứ không dùng độ lệch cố định:
 *  độ lệch đổi hai lần mỗi năm và đổi vào ngày khác nhau giữa Anh và lục địa. */
export const LEAGUE_TIMEZONE: Record<string, string> = {
  "en.1": "Europe/London",
  "es.1": "Europe/Madrid",
  "it.1": "Europe/Rome",
  "de.1": "Europe/Berlin",
  "fr.1": "Europe/Paris",
};

export const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * Số trận chưa đá tối đa mà DATASET mang theo.
 *
 * Trần của TẦNG VẬN CHUYỂN, không phải của trang: `fixtureLimit` trong
 * entity-spec quyết định trang in bao nhiêu (5 cho đội, 10 cho giải). Trần
 * này chỉ chặn việc nhét cả 330 trận còn lại của Ngoại hạng Anh vào mỗi
 * phản hồi API.
 *
 * Hai con số ở hai nơi là một chỗ trôi lệch: đặt `fixtureLimit` lớn hơn trần
 * này thì trang xin 30 và nhận 20, KHÔNG có gì đỏ lên, và trang trông như
 * giải chỉ còn 20 trận. `verify-entity-spec.ts` đỏ khi hai số lệch nhau.
 */
export const UPCOMING_CAP = 20;


export interface UpcomingMatch {
  /** Ngày thi đấu theo giờ GIẢI, ISO "2026-10-10". Giữ lại để đối chiếu nguồn. */
  sourceDate: string;
  /** Giờ theo giờ GIẢI, "15:00". */
  sourceTime: string | null;
  round: string;
  home: string;
  away: string;
  /**
   * Thời điểm tuyệt đối. null khi nguồn không ghi giờ — và null phải được
   * hiển thị là "chưa có giờ", KHÔNG được điền 00:00. Cùng luật với
   * `halfTime: null` nghĩa là "không biết", không phải 0-0.
   */
  kickoff: Date | null;
  /** Ngày giờ đã quy về Việt Nam, "10/10/2026 21:00". null khi không có giờ. */
  kickoffVn: string | null;
  /** Ngày ở Việt Nam có thể LỆCH ngày của giải — trận 21:00 ở Tây Ban Nha là
   *  02:00 hôm sau ở Việt Nam. Trang phải in ngày Việt Nam, nếu không người
   *  đọc chờ nhầm đêm. */
  dateVn: string | null;
}

/** Độ lệch (phút) của một múi giờ tại một thời điểm. */
function offsetMinutes(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  // `hour` có thể là "24" ở hour12:false trên một số ICU — quy về 0.
  const hour = Number(p.hour) % 24;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return (asUtc - at.getTime()) / 60000;
}

/**
 * Giờ treo tường ở một múi giờ -> thời điểm tuyệt đối.
 *
 * Lặp HAI lần chứ không một: lần đầu ước lượng độ lệch tại một thời điểm
 * đoán, và nếu thời điểm đoán rơi khác phía ranh giới DST so với thời điểm
 * thật thì độ lệch ấy sai đúng một tiếng. Lần hai đo lại tại thời điểm đã
 * hiệu chỉnh. Hai lần là đủ cho mọi ranh giới DST một tiếng.
 */
export function zonedWallClockToInstant(date: string, time: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60000);
  return guess;
}

function formatVn(at: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: VN_TIMEZONE, ...opts }).format(at);
}

function toUpcoming(match: FootballMatch, leagueCode: string): UpcomingMatch {
  const tz = LEAGUE_TIMEZONE[leagueCode];
  const kickoff = tz && match.time ? zonedWallClockToInstant(match.date, match.time, tz) : null;
  return {
    sourceDate: match.date,
    sourceTime: match.time ?? null,
    round: match.round,
    home: match.home,
    away: match.away,
    kickoff,
    kickoffVn: kickoff ? formatVn(kickoff, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : null,
    dateVn: kickoff ? formatVn(kickoff, { day: "2-digit", month: "2-digit", year: "numeric" }) : null,
  };
}

/**
 * Trận CHƯA đá, sớm nhất trước.
 *
 * Lọc theo `fullTime === null` — cùng định nghĩa mà `playedMatches` dùng ở
 * chiều ngược lại, nên hai tập không bao giờ chồng nhau hay hụt nhau.
 *
 * KHÔNG lọc theo "ngày lớn hơn hôm nay": một trận hoãn vẫn mang ngày cũ mà
 * chưa có tỷ số, và loại nó đi sẽ giấu mất đúng trận người đọc đang hỏi.
 */
export function upcomingMatches(
  matches: readonly FootballMatch[],
  leagueCode: string,
  opts: { team?: string; limit?: number } = {}
): UpcomingMatch[] {
  const rows = matches
    .filter((m) => m.fullTime === null)
    .filter((m) => (opts.team ? m.home === opts.team || m.away === opts.team : true))
    .sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") : a.date.localeCompare(b.date)))
    .map((m) => toUpcoming(m, leagueCode));
  return opts.limit === undefined ? rows : rows.slice(0, opts.limit);
}
