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
/**
 * Dòng trận. Giờ và tỷ số đều có thể vắng, và phần tỷ số có BỐN hình dạng.
 *
 * Bốn hình dạng này KHÔNG phải suy đoán — đã liệt kê toàn bộ phần đuôi của
 * mọi dòng trận trong 6 mùa Champions League (21/9/2026), thay mọi chữ số
 * bằng N rồi đếm:
 *
 *     N-N (N-N)                        799   thường
 *     N-N                               45   nguồn không ghi hiệp một
 *     N-N a.e.t. (N-N, N-N)              5   phải đá hiệp phụ
 *     N-N pen. N-N a.e.t. (N-N, N-N)     6   và đá luân lưu
 *
 * BIỂU THỨC CŨ CHỈ ĐỌC ĐƯỢC HAI HÌNH ĐẦU, và nó hỏng đúng theo kiểu nguy
 * hiểm nhất: phần đuôi không khớp bị nuốt vào TÊN ĐỘI KHÁCH. Kết quả là một
 * đội tên "Paris Saint-Germain FC (FRA)  1-4 pen. 0-1 a.e.t. (0-1, 0-1)" và
 * một trận không có tỷ số — không ném lỗi, không đỏ ở đâu cả.
 *
 * Quy mô đúng bằng số dòng hiệp phụ, mùa nào cũng khớp tuyệt đối:
 *
 *     2020-21  124/125 trận có tỷ số   1 dòng a.e.t.
 *     2021-22  123/125                 2
 *     2022-23  125/125                 0
 *     2023-24  122/125                 3
 *     2024-25  187/189                 2
 *     2025-26  186/189                 3
 *
 * Giải quốc nội KHÔNG dính: đã đếm, 0 dòng a.e.t./pen. trong cả bốn file
 * 2026-27 đang dùng làm lớp phủ. Lỗi này ngủ yên vì trận vòng tròn không bao
 * giờ đá hiệp phụ — nó chỉ tỉnh dậy ở cúp.
 *
 * THỨ TỰ CÁC SỐ BỊ ĐẢO so với trực giác đọc: số dẫn đầu dòng là tỷ số SAU
 * HIỆP PHỤ, còn phút 90 nằm trong ngoặc đầu. Chứng minh bằng tính đơn điệu
 * chứ không bằng phỏng đoán: "3-2 a.e.t. (3-0, 1-0)" — nếu ngoặc đầu là hiệp
 * một thì tỷ số sẽ GIẢM từ 3-0 xuống 1-0, điều không xảy ra được. Và đối
 * chiếu với bản JSON của cùng trận cho thấy `ft` bên đó khớp ngoặc đầu.
 */
const MATCH_RE = new RegExp(
  "^\\s*(?:(\\d{1,2}:\\d{2})\\s+)?" + // 1  giờ
    "(.+?)\\s+v\\s+(.+?)" + //               2  chủ, 3 khách
    "(?:\\s{2,}" +
    "(?:(\\d+)-(\\d+)\\s+pen\\.\\s+)?" + // 4,5  luân lưu
    "(\\d+)-(\\d+)" + //                        6,7  tỷ số dẫn đầu dòng
    "(\\s+a\\.e\\.t\\.)?" + //              8    dấu hiệu hiệp phụ
    "(?:\\s+\\((?:(\\d+)-(\\d+),\\s*)?(\\d+)-(\\d+)\\))?" + // 9,10 phút 90; 11,12 hiệp một
    ")?\\s*$"
);
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
    const [, time, home, away, ph, pa, lh, la, aet, nh, na, hh, ha] = m;
    const lead: [number, number] | null = lh !== undefined ? [Number(lh), Number(la)] : null;
    const ninety: [number, number] | null = nh !== undefined ? [Number(nh), Number(na)] : null;
    out.push({
      round,
      date: currentDate,
      time: time ?? undefined,
      home: home.trim(),
      away: away.trim(),
      // Có hiệp phụ thì số dẫn đầu dòng là tỷ số sau 120 phút, còn phút 90
      // nằm trong ngoặc đầu. Không có hiệp phụ thì số dẫn đầu CHÍNH LÀ phút
      // 90. Giữ `fullTime` luôn nghĩa "phút 90" để đối chiếu được với JSON.
      fullTime: aet ? ninety : lead,
      halfTime: hh !== undefined ? [Number(hh), Number(ha)] : null,
      extraTime: aet ? lead : null,
      penalties: ph !== undefined ? [Number(ph), Number(pa)] : null,
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
