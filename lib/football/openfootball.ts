import { z } from "zod";
import { fetchSeasonTxt, hasTxtOverlay } from "./openfootball-txt";

/**
 * Lịch thi đấu và kết quả, đọc từ openfootball/football.json.
 *
 * ═══ VÌ SAO NGUỒN NÀY, VÀ VÌ SAO BẢN JSON ═══
 *
 * openfootball công bố cùng một mùa ở HAI dạng: file .txt cho người đọc, và
 * .json cho máy. Đo 21/9/2026 trên Ngoại hạng Anh 2026-27, và hai dạng KHÔNG
 * tương đương:
 *
 *   .txt   45/380 trận có tỷ số, kết quả tới Sun Sep 20
 *   .json  40/380,                kết quả tới 2026-09-14 — TRỄ MỘT TUẦN
 *
 * Trễ một tuần, không phải hai ngày như ước lượng ban đầu từ ngày commit: các
 * trận 18, 19, 20/9 ĐÃ đá và có trong .txt, còn JSON vẫn khai là chưa đá.
 * Không phải nghỉ FIFA — đã đối chiếu từng ngày.
 *
 * Chọn JSON dù trễ hơn, vì bản .txt đổi ĐỊNH DẠNG giữa các mùa:
 *
 *   2025-26   "19:00   Liverpool  4-2 (1-0)  Bournemouth"   tỷ số Ở GIỮA
 *   2026-27   "16:30  Fulham FC  v Manchester United FC  1-1 (0-0)"  ở CUỐI
 *   nhãn vòng "Regular Season - 1"  so với  "Matchday 6"
 *   tên đội   "Liverpool"           so với  "Liverpool FC"
 *
 * Một parser viết theo một mùa sẽ CẮT SAI TÊN ĐỘI ở mùa kia — và cắt sai tên
 * thì không ném lỗi, nó chỉ tạo ra một đội tên "Manchester United FC  1" rồi
 * mọi tầng sau coi đó là thật. Hai ngày trễ là cái giá rẻ hơn nhiều so với
 * một lớp lỗi im lặng.
 *
 * ĐỘ TRỄ KHÔNG BỊ GIẤU: `stalenessDays` đi kèm mỗi lần đọc, tính từ trận mới
 * nhất CÓ tỷ số. Với truy vấn "kết quả bóng đá" (1,5 triệu lượt/tháng ở VN),
 * trễ một tuần nghĩa là trang hiện vòng đấu vừa xong là "sắp diễn ra" — sai
 * công khai, ở đúng chỗ đông người nhất.
 *
 * Nên nguồn này ĐỦ cho lịch thi đấu, bảng xếp hạng và mùa đã kết thúc; CHƯA
 * đủ cho kết quả mới. Bù được bằng cách phủ thêm bản .txt lên trên và đối
 * chiếu chéo: trận nào cả hai cùng có thì tỷ số phải khớp — một cổng canh có
 * sẵn thay vì tin một nguồn.
 *
 * ═══ CHƯA CÓ ═══
 *
 * Champions League KHÔNG có bản JSON (cl.json trả 404 cho cả 2025-26 lẫn
 * 2026-27) — chỉ có .txt. Nên giải đó chưa vào đây, và sẽ cần đúng cái parser
 * .txt mà chú thích trên vừa giải thích là dễ vỡ.
 *
 * V.League KHÔNG có ở openfootball. Nguồn miễn phí duy nhất tìm được cho giải
 * VN là TheSportsDB, và nó trả Wigan Athletic/Blackpool/Leicester làm đội
 * V.League 1 — dữ liệu sai chứ không phải thiếu.
 */

const Pair = z.tuple([z.number(), z.number()]);

/**
 * Tỷ số có HAI hình dạng trong cùng một file, và khác biệt mang thông tin.
 *
 * Cổng canh bắt được ngay lần chạy đầu: 4/380 trận Ngoại hạng Anh 2026-27 có
 * `score` là MẢNG thay vì object. Xuất hiện ở nhiều giải — en 4, es 4, fr 4,
 * de 2, it 0 — nên không phải một lỗi lẻ.
 *
 * Nghi là dữ liệu hỏng, nên đối chiếu với bản .txt của chính nguồn đó: cả bốn
 * trận ĐÚNG là hoà 0-0. Rồi kiểm giả thuyết trên toàn bộ file:
 *
 *   score dạng MẢNG  : 4 trận,  0/4  có tỷ số hiệp 1 trong .txt
 *   score dạng OBJECT: 36 trận, 36/36 có
 *
 * Nghĩa là: dạng mảng = "chỉ biết tỷ số chung cuộc, KHÔNG biết hiệp một".
 * openfootball suy tỷ số hiệp một từ phút ghi bàn, nên trận 0-0 không có bàn
 * nào để suy.
 *
 * `halfTime: null` chứ KHÔNG phải [0,0]. Một trận 0-0 chung cuộc rất có thể
 * cũng 0-0 hiệp một — nhưng "rất có thể" không phải "đã đo", và điền 0-0 vào
 * đó là bịa một sự thật chưa ai ghi. Trang nào muốn hiện tỷ số hiệp một phải
 * tự xử lý ca không có, chứ không nhận một con số không có nguồn.
 */
const ScoreSchema = z.union([
  z.object({ ht: Pair.optional(), ft: Pair }),
  Pair.transform((ft) => ({ ht: undefined, ft })),
]);

const MatchSchema = z.object({
  round: z.string(),
  date: z.string(),
  time: z.string().optional(),
  team1: z.string(),
  team2: z.string(),
  score: ScoreSchema.optional(),
});

const SeasonSchema = z.object({
  name: z.string(),
  matches: z.array(MatchSchema),
});

type RawMatch = z.infer<typeof MatchSchema>;

export interface FootballMatch {
  round: string;
  /** ISO, "2026-09-12". */
  date: string;
  time?: string;
  home: string;
  away: string;
  /** null = chưa đá. */
  fullTime: [number, number] | null;
  /** null = ĐÃ đá nhưng nguồn không ghi tỷ số hiệp một — xem ScoreSchema. */
  halfTime: [number, number] | null;
}

function normalise(m: RawMatch): FootballMatch {
  return {
    round: m.round,
    date: m.date,
    time: m.time,
    home: m.team1,
    away: m.team2,
    fullTime: m.score ? m.score.ft : null,
    halfTime: m.score?.ht ?? null,
  };
}

export interface LeagueSeason {
  /** Mã openfootball: "en.1", "es.1"… */
  code: string;
  /** "2026-27" */
  season: string;
  /** Tên giải theo nguồn, ví dụ "English Premier League 2026/27". */
  name: string;
  matches: FootballMatch[];
  teams: string[];
  played: number;
  /** Ngày của trận MỚI NHẤT có tỷ số, hoặc null khi mùa chưa đá trận nào. */
  lastResultDate: string | null;
  /**
   * Số ngày từ trận mới nhất có tỷ số tới hôm nay.
   *
   * KHÔNG phải "kho cập nhật khi nào": kho có thể commit hôm nay mà không
   * thêm kết quả nào vì tuần đó nghỉ FIFA. Đây là câu hỏi thật — "dữ liệu
   * mới tới đâu" — và nó trả lời được mà không cần hỏi GitHub.
   */
  stalenessDays: number | null;
}

const BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";

/** Giải đã đo được là CÓ bản JSON cho mùa đang đá, 21/9/2026. */
export const LEAGUES = {
  "en.1": "Ngoại hạng Anh",
  "es.1": "La Liga",
  "it.1": "Serie A",
  "de.1": "Bundesliga",
  "fr.1": "Ligue 1",
} as const;

export type LeagueCode = keyof typeof LEAGUES;

export async function fetchLeagueSeason(
  code: LeagueCode,
  season: string,
  now: Date,
): Promise<LeagueSeason> {
  const url = `${BASE}/${season}/${code}.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`openfootball ${code} ${season}: HTTP ${res.status} tại ${url}`);
  }

  const parsed = SeasonSchema.safeParse(await res.json());
  if (!parsed.success) {
    // Hình dạng đổi thì DỪNG, không đoán. Nguồn này do tình nguyện viên duy
    // trì và đã đổi định dạng .txt giữa hai mùa liền nhau; giả định JSON
    // đứng yên mãi là giả định không có cơ sở.
    throw new Error(
      `openfootball ${code} ${season}: JSON không đúng hình dạng mong đợi — ${parsed.error.issues[0]?.message}`
    );
  }

  const matches = parsed.data.matches.map(normalise);
  const teams = [...new Set(matches.flatMap((m) => [m.home, m.away]))].sort();
  const withScore = matches.filter((m) => m.fullTime !== null);
  const lastResultDate = withScore.length > 0 ? withScore.map((m) => m.date).sort().at(-1)! : null;

  return {
    code,
    season,
    name: parsed.data.name,
    matches,
    teams,
    played: withScore.length,
    lastResultDate,
    stalenessDays: lastResultDate
      ? Math.floor((now.getTime() - new Date(`${lastResultDate}T00:00:00Z`).getTime()) / 86_400_000)
      : null,
  };
}

/** Bảng xếp hạng tính từ chính các trận đã đá — không lấy từ nguồn thứ hai.
 *
 *  Nguồn chỉ có trận; bảng là phép cộng trên đó. Lấy bảng từ nơi khác nghĩa là
 *  hai con số cho cùng một sự thật, và chúng sẽ lệch đúng vào ngày có trận
 *  hoãn hoặc trừ điểm — tức đúng ngày người ta vào xem. */
export interface StandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export function buildStandings(season: LeagueSeason): StandingRow[] {
  const table = new Map<string, StandingRow>();
  const row = (team: string): StandingRow => {
    const r = table.get(team) ?? { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
    table.set(team, r);
    return r;
  };
  for (const t of season.teams) row(t);

  for (const m of season.matches) {
    if (!m.fullTime) continue;
    const [h, a] = m.fullTime;
    const home = row(m.home);
    const away = row(m.away);
    home.played++; away.played++;
    home.goalsFor += h; home.goalsAgainst += a;
    away.goalsFor += a; away.goalsAgainst += h;
    if (h > a) { home.won++; away.lost++; home.points += 3; }
    else if (h < a) { away.won++; home.lost++; away.points += 3; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }

  return [...table.values()].sort(
    (x, y) =>
      y.points - x.points ||
      (y.goalsFor - y.goalsAgainst) - (x.goalsFor - x.goalsAgainst) ||
      y.goalsFor - x.goalsFor ||
      x.team.localeCompare(y.team)
  );
}


/**
 * Nền JSON + lớp phủ .txt, và chỗ chồng lấn là CỔNG CANH.
 *
 * Khoá ghép là CẶP ĐỘI, không phải ngày. Trong giải vòng tròn hai lượt, mỗi
 * cặp (chủ, khách) xuất hiện đúng một lần — đó là bất biến của thể thức, và
 * cổng canh đã kiểm nó. Ghép theo ngày thì một trận bị hoãn mà chỉ một nguồn
 * cập nhật sẽ thành hai trận khác nhau, rồi tỷ số bị phủ lên nhầm chỗ.
 *
 * XUNG ĐỘT KHÔNG ĐƯỢC PHỦ IM LẶNG. Hai nguồn cùng khai tỷ số mà khác nhau
 * nghĩa là ít nhất một bên sai, và không có cách nào biết bên nào từ trong
 * chỗ này. Nên giữ NỀN, ghi xung đột ra, và để cổng canh làm nó đỏ — chọn
 * bừa một bên là biến một mâu thuẫn đo được thành một con số trông chắc
 * chắn.
 */
export interface MergedSeason extends LeagueSeason {
  /** Số trận lấy được tỷ số từ .txt mà JSON chưa có. */
  overlaid: number;
  /** Trận mà hai nguồn khai hai tỷ số khác nhau. Rỗng là điều kiện bình thường. */
  conflicts: { home: string; away: string; base: [number, number]; overlay: [number, number] }[];
  /** Cặp đội có trong .txt mà KHÔNG có trong nền — tên đội lệch giữa hai bản. */
  unmatched: string[];
  overlaySource: "txt" | "none";
}

export async function fetchLeagueSeasonMerged(
  code: LeagueCode,
  season: string,
  now: Date,
): Promise<MergedSeason> {
  const base = await fetchLeagueSeason(code, season, now);
  if (!hasTxtOverlay(code)) {
    return { ...base, overlaid: 0, conflicts: [], unmatched: [], overlaySource: "none" };
  }

  const txt = await fetchSeasonTxt(code, season);
  const key = (h: string, a: string) => `${h}\u0000${a}`;
  const byPair = new Map(base.matches.map((m) => [key(m.home, m.away), m]));

  const conflicts: MergedSeason["conflicts"] = [];
  const unmatched: string[] = [];
  let overlaid = 0;

  for (const t of txt.matches) {
    if (!t.fullTime) continue;
    const b = byPair.get(key(t.home, t.away));
    if (!b) { unmatched.push(`${t.home} v ${t.away}`); continue; }
    if (b.fullTime) {
      if (b.fullTime[0] !== t.fullTime[0] || b.fullTime[1] !== t.fullTime[1]) {
        conflicts.push({ home: t.home, away: t.away, base: b.fullTime, overlay: t.fullTime });
      }
      continue;
    }
    b.fullTime = t.fullTime;
    // Tỷ số hiệp một chỉ nhận khi .txt thật sự có. Trận 0-0 trong .txt cũng
    // không ghi hiệp một, đúng như bản JSON — xem ScoreSchema.
    b.halfTime = t.halfTime;
    overlaid++;
  }

  const withScore = base.matches.filter((m) => m.fullTime !== null);
  const lastResultDate = withScore.length > 0 ? withScore.map((m) => m.date).sort().at(-1)! : null;

  return {
    ...base,
    played: withScore.length,
    lastResultDate,
    stalenessDays: lastResultDate
      ? Math.floor((now.getTime() - new Date(`${lastResultDate}T00:00:00Z`).getTime()) / 86_400_000)
      : null,
    overlaid,
    conflicts,
    unmatched,
    overlaySource: "txt",
  };
}
