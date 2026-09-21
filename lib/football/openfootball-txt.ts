import type { FootballMatch } from "./openfootball";
import type { LeagueCode } from "./openfootball";

/**
 * Lớp phủ KẾT QUẢ MỚI, đọc từ bản .txt của openfootball.
 *
 * ═══ VÌ SAO CẦN ═══
 *
 * Bản JSON trễ một tuần. Đo 21/9/2026 trên Ngoại hạng Anh 2026-27: JSON khai
 * các trận 18, 19, 20/9 là chưa đá, trong khi .txt đã có tỷ số. Với truy vấn
 * "kết quả bóng đá" (1,5 triệu lượt/tháng ở VN) thì đó là sai ở chỗ đông
 * người nhất.
 *
 * ═══ VÌ SAO ĐÂY LÀ LỚP PHỦ, KHÔNG PHẢI NGUỒN THAY THẾ ═══
 *
 * .txt đổi định dạng giữa các mùa — tỷ số ở giữa hay ở cuối, có "v" hay
 * không, "Liverpool" hay "Liverpool FC". JSON giữ hình dạng ổn định và có
 * schema kiểm được. Nên JSON là NỀN (danh sách trận, tên đội), .txt chỉ bù
 * phần tỷ số mà nền chưa có.
 *
 * Và vì cả hai cùng mô tả một sự thật, chỗ chồng lấn thành CỔNG CANH: trận
 * nào cả hai cùng có tỷ số thì hai tỷ số phải khớp. Hai nguồn độc lập đồng ý
 * là bằng chứng; một nguồn nói một mình thì chỉ là lời khai.
 *
 * ═══ HAI BẪY TRONG ĐỊNH DẠNG NÀY ═══
 *
 * 1. NĂM BỊ BỎ TRỐNG. Đo trên file mùa 2026-27: 62/64 dòng ngày KHÔNG có
 *    năm. Nguồn chỉ ghi năm ở đầu mùa ("Fri Aug 21 2026") và ngày đầu năm
 *    mới ("Fri Jan 1 2027"). Một parser chỉ mang năm đầu mùa đi tiếp sẽ đặt
 *    mọi trận tháng 1-5 sớm hơn MỘT NĂM — và nó không ném lỗi, chỉ cho ra
 *    một mùa giải lệch chỗ.
 *
 *    Nên có hai lớp: mang năm theo, VÀ tự tăng năm khi tháng lùi lại
 *    (tháng 12 -> tháng 1). Rồi kiểm mọi ngày nằm trong khoảng mùa mà chính
 *    file khai ở dòng "# Date". Không dựa vào quy ước của nguồn.
 *
 * 2. TÊN ĐỘI CÓ DẤU CÁCH VÀ "&". "Brighton & Hove Albion FC" —
 *    tách bằng khoảng trắng là hỏng. Dấu tách duy nhất tin được là " v ", và
 *    đã kiểm: không đội nào có " v " trong tên.
 */

const TXT_REPO: Partial<Record<LeagueCode, { repo: string; file: string }>> = {
  "en.1": { repo: "england", file: "1-premierleague" },
  "es.1": { repo: "espana", file: "1-liga" },
  "it.1": { repo: "italy", file: "1-seriea" },
  "de.1": { repo: "deutschland", file: "1-bundesliga" },
  // fr.1 KHÔNG có: openfootball không có kho "france" (đã liệt kê cả 36 kho
  // của tổ chức, 21/9/2026). Ligue 1 vì thế chỉ có JSON và sẽ trễ — khai ra
  // ở đây để chỗ gọi biết, thay vì lặng lẽ không phủ được gì.
};

export function hasTxtOverlay(code: LeagueCode): boolean {
  return code in TXT_REPO;
}

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** "Fri Aug 21 2026" hoặc "Sat Aug 22" (năm bỏ trống). */
const DATE_RE = /^\s*\w{3}\s+(\w{3})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/;
/** "  20:00  Arsenal FC  v Coventry City FC   3-0 (2-0)" — giờ và tỷ số đều có thể vắng. */
const MATCH_RE =
  /^\s*(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+v\s+(.+?)(?:\s{2,}(\d+)-(\d+)(?:\s+\((\d+)-(\d+)\))?)?\s*$/;
const ROUND_RE = /^\s*▪\s*(.+?)\s*$/;
/** "# Date       Fri Aug 21 2026 - Sun May 30 2027 (282d)" */
const RANGE_RE = /^#\s*Dates?\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\s*-\s*\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/;

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface TxtSeason {
  matches: FootballMatch[];
  /** Khoảng mùa mà chính file khai, dùng để kiểm ngày đã suy ra. */
  range: { from: string; to: string } | null;
}

export function parseSeasonTxt(text: string): TxtSeason {
  const out: FootballMatch[] = [];
  let round = "";
  let year: number | null = null;
  let lastMonth: number | null = null;
  let currentDate: string | null = null;
  let range: TxtSeason["range"] = null;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;

    const rg = RANGE_RE.exec(line);
    if (rg) {
      range = {
        from: iso(Number(rg[3]), MONTHS[rg[1]] ?? 0, Number(rg[2])),
        to: iso(Number(rg[6]), MONTHS[rg[4]] ?? 0, Number(rg[5])),
      };
      continue;
    }
    if (line.trimStart().startsWith("#") || line.startsWith("=")) continue;

    const r = ROUND_RE.exec(line);
    if (r) { round = r[1]; continue; }

    const d = DATE_RE.exec(line);
    if (d) {
      const month = MONTHS[d[1]];
      if (!month) continue;
      if (d[3]) year = Number(d[3]);
      // Tháng LÙI so với dòng ngày trước nghĩa là đã sang năm mới. Lớp thứ
      // hai, độc lập với việc nguồn có ghi năm hay không.
      else if (year !== null && lastMonth !== null && month < lastMonth) year += 1;
      lastMonth = month;
      if (year !== null) currentDate = iso(year, month, Number(d[2]));
      continue;
    }

    const m = MATCH_RE.exec(line);
    if (!m || !currentDate) continue;
    const [, time, home, away, fh, fa, hh, ha] = m;
    out.push({
      round,
      date: currentDate,
      time: time ?? undefined,
      home: home.trim(),
      away: away.trim(),
      fullTime: fh !== undefined ? [Number(fh), Number(fa)] : null,
      halfTime: hh !== undefined ? [Number(hh), Number(ha)] : null,
    });
  }

  return { matches: out, range };
}

export async function fetchSeasonTxt(code: LeagueCode, season: string): Promise<TxtSeason> {
  const loc = TXT_REPO[code];
  if (!loc) throw new Error(`openfootball không có bản .txt cho ${code}`);
  const url = `https://raw.githubusercontent.com/openfootball/${loc.repo}/master/${season}/${loc.file}.txt`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`openfootball .txt ${code} ${season}: HTTP ${res.status} tại ${url}`);
  const parsed = parseSeasonTxt(await res.text());

  // Mọi ngày suy ra phải nằm trong khoảng mùa mà chính file khai. Đây là chỗ
  // bẫy "năm bỏ trống" bị bắt: lệch một năm thì ngày rơi ra ngoài khoảng.
  if (parsed.range) {
    const bad = parsed.matches.filter((m) => m.date < parsed.range!.from || m.date > parsed.range!.to);
    if (bad.length > 0) {
      throw new Error(
        `openfootball .txt ${code} ${season}: ${bad.length} trận có ngày ngoài khoảng mùa ` +
          `${parsed.range.from}…${parsed.range.to} — ví dụ ${bad[0].date} ${bad[0].home} v ${bad[0].away}. ` +
          `Nhiều khả năng năm bị suy sai.`
      );
    }
  }
  return parsed;
}
