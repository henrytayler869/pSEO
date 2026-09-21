import { z } from "zod";
import { usablePenalties, type FootballMatch } from "./openfootball";
import { parseSeasonTxt } from "./openfootball-txt";

/**
 * Champions League — LƯU TRỮ, không phải kết quả đang diễn ra.
 *
 * ═══ VÌ SAO CHỈ LƯU TRỮ ═══
 *
 * Đo 21/9/2026. Kho openfootball/champions-league KHÔNG có thư mục 2026-27;
 * mùa mới nhất là 2025-26, và lần đẩy cuối là 2/7/2026 — 81 ngày trước.
 * Cùng lúc đó england, espana, italy, deutschland đều được đẩy trong ngày.
 *
 * Kể cả khi có, nó tới muộn. Mùa 2025-26 đá trận đầu 16/9/2025; commit đầu
 * tiên chạm file là 4/11/2025 — muộn 49 ngày — rồi im lặng suốt 99 ngày từ
 * 11/11/2025 tới 18/2/2026, trùm gần hết vòng bảng. Cả mùa 256 ngày chỉ có
 * 39 commit rải trên 13 ngày.
 *
 * Nên trang lịch/kết quả C1 dựng trên nguồn này sẽ trống hoặc cũ đúng lúc
 * đông người xem nhất. Trang LƯU TRỮ thì không có vấn đề đó: mùa đã kết thúc
 * không đổi nữa, và 15 mùa đầy đủ là thứ đọc được quanh năm.
 *
 * ═══ HAI NGUỒN, GHÉP THÀNH 15 MÙA LIÊN TIẾP ═══
 *
 *     2011-12 … 2019-20   uefa.cl.json     9 mùa
 *     2020-21 … 2025-26   cl.txt           6 mùa
 *     2024-25             CÓ CẢ HAI        -> dùng làm cổng đối chiếu chéo
 *
 * Mùa chồng lấn không thừa. Nó là chỗ duy nhất hai nguồn cùng mô tả một sự
 * thật, và lần chạy đầu tiên đã lộ ba khiếm khuyết trong bản JSON mà nếu chỉ
 * có một nguồn thì không cách nào biết:
 *
 *   - trận CHUNG KẾT 2024-25 mang `"score": {}` — không có tỷ số
 *   - cả hai trận luân lưu đều ghi `p: [4,4]`, một kết quả không tồn tại
 *   - .txt có 189/189 tỷ số, JSON có 188
 *
 * ═══ TÊN ĐỘI KHÔNG ỔN ĐỊNH QUA CÁC MÙA ═══
 *
 * "Real Madrid (ESP)" ở 2015-16 và "Real Madrid CF (ESP)" ở 2025-26 là cùng
 * một câu lạc bộ, và ở đây chúng là hai chuỗi khác nhau. KHÔNG gộp lại: gộp
 * đúng thì được một bảng, gộp sai thì được một bảng TRÔNG CŨNG ĐÚNG NHƯ THẾ.
 * Trang nào cần thống kê xuyên mùa phải tự khai bảng đồng nghĩa và tự chịu
 * trách nhiệm; cổng canh đếm và in ra số chuỗi tên để biết việc đó to cỡ nào.
 */

const JSON_BASE = "https://raw.githubusercontent.com/openfootball/football.json/master";
const TXT_BASE = "https://raw.githubusercontent.com/openfootball/champions-league/master";

/** Mùa có `uefa.cl.json`. Liệt kê tường minh vì nguồn THIẾU 2020-21…2023-24. */
export const UCL_JSON_SEASONS = [
  "2011-12", "2012-13", "2013-14", "2014-15", "2015-16",
  "2016-17", "2017-18", "2018-19", "2019-20", "2024-25",
] as const;

/** Mùa có `cl.txt`. */
export const UCL_TXT_SEASONS = [
  "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26",
] as const;

/** 15 mùa liên tiếp, hợp của hai danh sách trên. */
export const UCL_ARCHIVE_SEASONS: readonly string[] = [
  ...new Set([...UCL_JSON_SEASONS, ...UCL_TXT_SEASONS]),
].sort();

export type UclSource = "json" | "txt";

/** .txt giàu hơn: nó có tỷ số luân lưu, JSON thì ghi sai hoặc bỏ trống. */
export function preferredSource(season: string): UclSource {
  return (UCL_TXT_SEASONS as readonly string[]).includes(season) ? "txt" : "json";
}

export type UclStage =
  | "group"
  | "league-phase"
  | "knockout-playoff"
  | "knockout"
  | "final";

/**
 * Nhãn vòng đổi BỐN LẦN trong 15 mùa, nên phân loại phải theo bảng chứ không
 * theo linh cảm. Đã liệt kê toàn bộ nhãn thật có trong dữ liệu:
 *
 *   2011-12…2022-23   "Group A"…"Group F", "Gruppe G", "Gruppe H",
 *                     "Round of 16", "Quarterfinals", "Semifinals", "Final"
 *   2023-24           "Group, Matchday N", "Finals, Round of 16", …
 *   2024-25…          "League, Matchday N", "Playoffs, Matchday N", "Finals, …"
 *
 * "Gruppe G" và "Gruppe H" là tiếng Đức, ngay giữa một file tiếng Anh — ba
 * mùa liền đều vậy. Không phải lỗi gõ của một người; nó là thứ phải đọc được.
 *
 * Trả null khi gặp nhãn lạ, và cổng canh làm nó đỏ. Một nhánh `else` gom mọi
 * thứ chưa biết vào "knockout" sẽ nuốt đúng cái ngày nguồn đổi định dạng lần
 * thứ năm.
 */
export function classifyStage(round: string): UclStage | null {
  const [headRaw, tailRaw] = round.split(",");
  const head = headRaw.trim();
  const tail = (tailRaw ?? "").trim();
  if (/^(Group|Gruppe)\b/.test(head)) return "group";
  if (head === "League") return "league-phase";
  if (head === "Playoffs") return "knockout-playoff";
  if (head === "Final") return "final";
  if (head === "Finals") return tail === "Final" ? "final" : "knockout";
  if (["Round of 32", "Round of 16", "Eighthfinals", "Quarterfinals", "Semifinals"].includes(head)) {
    return "knockout";
  }
  return null;
}

export interface UclMatch extends FootballMatch {
  stage: UclStage;
  /** Tên đội đã tách khỏi hậu tố nước: "Arsenal FC". */
  homeClub: string;
  awayClub: string;
  /** Mã nước ba chữ theo nguồn: "ENG". */
  homeCountry: string;
  awayCountry: string;
  /** null khi trận chưa đá, hoặc hoà mà nguồn không ghi cách phân định. */
  winner: "home" | "away" | null;
  decidedBy: "90" | "aet" | "pen" | null;
}

/** "Arsenal FC (ENG)" -> club + country. Trả null nếu KHÔNG có hậu tố nước. */
export function splitTeam(name: string): { club: string; country: string } | null {
  const m = /^(.+?)\s*\(([A-Z]{3})\)$/.exec(name.trim());
  return m ? { club: m[1].trim(), country: m[2] } : null;
}

/**
 * Ai thắng, và thắng bằng gì.
 *
 * Thứ tự phân định là luật của giải: luân lưu quyết định trên hiệp phụ, hiệp
 * phụ quyết định trên phút 90. Đọc sai thứ tự thì trận chung kết 2011-12 ra
 * "hoà" thay vì "Chelsea vô địch".
 */
function decide(m: FootballMatch): Pick<UclMatch, "winner" | "decidedBy"> {
  const pen = usablePenalties(m.penalties);
  if (pen) return { winner: pen[0] > pen[1] ? "home" : "away", decidedBy: "pen" };
  if (m.extraTime && m.extraTime[0] !== m.extraTime[1]) {
    return { winner: m.extraTime[0] > m.extraTime[1] ? "home" : "away", decidedBy: "aet" };
  }
  if (m.fullTime && m.fullTime[0] !== m.fullTime[1]) {
    return { winner: m.fullTime[0] > m.fullTime[1] ? "home" : "away", decidedBy: "90" };
  }
  return { winner: null, decidedBy: null };
}

export interface UclSeason {
  season: string;
  name: string;
  source: UclSource;
  matches: UclMatch[];
  /** Chuỗi tên đội đúng như nguồn ghi, chưa gộp đồng nghĩa. */
  teams: string[];
  played: number;
  goals: number;
  final: UclMatch | null;
  champion: string | null;
  runnerUp: string | null;
  /**
   * Chỗ nguồn tự mâu thuẫn, ghi ra chứ không sửa. Rỗng là bình thường; mùa
   * 2024-25 bản JSON không rỗng.
   */
  defects: string[];
}

const Pair = z.tuple([z.number(), z.number()]);
const JsonSeason = z.object({
  name: z.string(),
  matches: z.array(
    z.object({
      round: z.string(),
      date: z.string(),
      time: z.string().optional(),
      team1: z.string(),
      team2: z.string(),
      score: z
        .object({ ht: Pair.optional(), ft: Pair.optional(), et: Pair.optional(), p: Pair.optional() })
        .optional(),
    })
  ),
});

async function text(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} tại ${url}`);
  return res.text();
}

export async function fetchUclSeason(season: string, source?: UclSource): Promise<UclSeason> {
  const src = source ?? preferredSource(season);
  const defects: string[] = [];
  let name: string;
  let raw: FootballMatch[];

  if (src === "json") {
    const parsed = JsonSeason.safeParse(JSON.parse(await text(`${JSON_BASE}/${season}/uefa.cl.json`)));
    if (!parsed.success) {
      throw new Error(`uefa.cl.json ${season}: hình dạng lạ — ${parsed.error.issues[0]?.message}`);
    }
    name = parsed.data.name;
    raw = parsed.data.matches.map((m) => ({
      round: m.round,
      date: m.date,
      time: m.time,
      home: m.team1,
      away: m.team2,
      fullTime: m.score?.ft ?? null,
      halfTime: m.score?.ht ?? null,
      extraTime: m.score?.et ?? null,
      penalties: m.score?.p ?? null,
    }));
  } else {
    const body = await text(`${TXT_BASE}/${season}/cl.txt`);
    const first = body.split("\n").find((l) => l.startsWith("="));
    name = first ? first.replace(/^=\s*/, "").trim() : `UEFA Champions League ${season}`;
    raw = parseSeasonTxt(body).matches;
  }

  const matches: UclMatch[] = [];
  for (const m of raw) {
    const stage = classifyStage(m.round);
    if (!stage) throw new Error(`${season} (${src}): nhãn vòng lạ "${m.round}" — chưa có chỗ xếp`);
    const h = splitTeam(m.home);
    const a = splitTeam(m.away);
    if (!h || !a) {
      // Mọi đội ở C1 đều mang hậu tố nước — đã kiểm 98/98 chuỗi tên trong 6
      // mùa. Thiếu hậu tố nghĩa là dòng bị cắt sai, không phải đội lạ.
      throw new Error(
        `${season} (${src}): tên đội không có hậu tố nước — "${!h ? m.home : m.away}". ` +
          `Nhiều khả năng phần tỷ số bị nuốt vào tên.`
      );
    }
    if (m.penalties && !usablePenalties(m.penalties)) {
      defects.push(`luân lưu hoà ${m.penalties[0]}-${m.penalties[1]} (không thể): ${m.home} v ${m.away}`);
    }
    matches.push({
      ...m,
      stage,
      homeClub: h.club,
      homeCountry: h.country,
      awayClub: a.club,
      awayCountry: a.country,
      ...decide(m),
    });
  }

  const finals = matches.filter((m) => m.stage === "final");
  if (finals.length > 1) throw new Error(`${season} (${src}): ${finals.length} trận chung kết`);
  const final = finals[0] ?? null;
  if (final && !final.fullTime) defects.push(`trận chung kết không có tỷ số: ${final.home} v ${final.away}`);

  const unscored = matches.filter((m) => !m.fullTime).length;
  if (unscored > 0) defects.push(`${unscored} trận không có tỷ số`);

  return {
    season,
    name,
    source: src,
    matches,
    teams: [...new Set(matches.flatMap((m) => [m.home, m.away]))].sort(),
    played: matches.filter((m) => m.fullTime).length,
    goals: matches.reduce((n, m) => n + (m.fullTime ? m.fullTime[0] + m.fullTime[1] : 0), 0),
    final,
    champion: final?.winner ? (final.winner === "home" ? final.home : final.away) : null,
    runnerUp: final?.winner ? (final.winner === "home" ? final.away : final.home) : null,
    defects,
  };
}
