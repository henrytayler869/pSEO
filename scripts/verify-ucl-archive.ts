/**
 * Cổng canh kho lưu trữ Champions League.
 *
 * Kho này khác kho giải quốc nội ở một điểm quyết định: BẤT BIẾN VÒNG TRÒN
 * HAI LƯỢT KHÔNG DÙNG ĐƯỢC. Cúp không có "số trận = n(n-1)", không có "mỗi
 * đội đá 2(n-1) trận", và từ 2024-25 hai đội còn gặp nhau HAI LẦN trên cùng
 * một sân — đo được 7 cặp như vậy ở mùa 2025-26. Nên phải thay bằng những
 * bất biến khác, mỗi cái bắt một cách hỏng riêng:
 *
 *   tên đội có hậu tố nước     bắt ca phần tỷ số bị nuốt vào tên đội — đúng
 *                              lỗi đã có thật, 11 trận trong 6 mùa
 *   mùa đã kết thúc đủ tỷ số   bắt ca parser bỏ sót một hình dạng tỷ số
 *   hiệp một <= 90' <= 120'    bàn thắng không giảm; bắt ca đọc ngược thứ tự
 *   luân lưu không hoà         luật của môn; bắt dữ liệu hỏng ở nguồn
 *   tổng bàn ghi = tổng thủng  bắt ca một trận bị đếm một phía
 *   mọi nhãn vòng xếp được     bắt ngày nguồn đổi định dạng lần nữa
 *   nhà vô địch khớp thực tế   bắt ca mọi thứ trên đều xanh mà dữ liệu vẫn
 *                              nói sai về thế giới
 */
import {
  UCL_ARCHIVE_SEASONS,
  UCL_JSON_SEASONS,
  UCL_TXT_SEASONS,
  fetchUclSeason,
  splitTeam,
  classifyStage,
  finalScoreLabel,
  type UclSeason,
} from "../lib/football/ucl-archive";
import { parseSeasonTxt } from "../lib/football/openfootball-txt";
import { usablePenalties } from "../lib/football/openfootball";

let failed = 0;
function check(ok: boolean, label: string) {
  console.log(`    ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failed++;
}

/**
 * NHÀ VÔ ĐỊCH THẬT, viết tay, đối chiếu với dữ liệu.
 *
 * Đây là phép kiểm duy nhất trong file này so dữ liệu với THẾ GIỚI chứ không
 * so dữ liệu với chính nó. Mọi bất biến còn lại đều có thể xanh trên một bộ
 * dữ liệu tự nhất quán mà sai — một mùa bị chép nhầm sang mùa khác vẫn cân
 * bàn thắng, vẫn đủ tỷ số, vẫn có đúng một trận chung kết.
 *
 * So bằng TỪ KHOÁ chứ không bằng chuỗi đầy đủ, vì tên đội đổi theo mùa:
 * "Real Madrid (ESP)" và "Real Madrid CF (ESP)" là một.
 *
 * 2025-26 KHÔNG có trong bảng — mùa đó kết thúc 30/5/2026 và tôi không có
 * cách nào xác nhận nhà vô địch ngoài chính dữ liệu đang kiểm. Một dòng viết
 * theo dữ liệu rồi dùng để kiểm dữ liệu là phép kiểm rỗng; thà thiếu một mùa
 * còn hơn có một dấu xanh không chứng minh gì.
 */
const CHAMPIONS: Record<string, string> = {
  "2011-12": "Chelsea",
  "2012-13": "Bayern",
  "2013-14": "Real Madrid",
  "2014-15": "Barcelona",
  "2015-16": "Real Madrid",
  "2016-17": "Real Madrid",
  "2017-18": "Real Madrid",
  "2018-19": "Liverpool",
  "2019-20": "Bayern",
  "2020-21": "Chelsea",
  "2021-22": "Real Madrid",
  "2022-23": "Manchester City",
  "2023-24": "Real Madrid",
  "2024-25": "Paris Saint-Germain",
};

/**
 * ĐỐI CHỨNG DƯƠNG. "Không có trận nào hỏng" có hai nghĩa: dữ liệu sạch, hoặc
 * phép dò hỏng. Phân biệt bằng cách đưa vào đúng cái lỗi đã từng xảy ra thật
 * và bắt nó phải kêu.
 */
function selfTest(): void {
  console.log("  đối chứng dương");

  const parsed = parseSeasonTxt(
    [
      "= T 2025/26",
      "# Date       Tue Sep 16 2025 - Sat May 30 2026 (256d)",
      "▪ Finals, Final",
      "  Sat May 30 2026",
      "           Paris Saint-Germain FC (FRA) v Arsenal FC (ENG)    4-3 pen. 1-1 a.e.t. (1-1, 0-1)",
      "    21:00  Juventus FC (ITA)       v Galatasaray SK (TUR)     3-2 a.e.t. (3-0, 1-0)",
      "           Bayer 04 Leverkusen (GER) v 1. FC Union Berlin (GER)  3-1",
    ].join("\n")
  ).matches;

  const pen = parsed[0];
  check(
    pen?.away === "Arsenal FC (ENG)" &&
      JSON.stringify(pen?.penalties) === "[4,3]" &&
      JSON.stringify(pen?.extraTime) === "[1,1]" &&
      JSON.stringify(pen?.fullTime) === "[1,1]" &&
      JSON.stringify(pen?.halfTime) === "[0,1]",
    "đọc được dòng luân lưu, và tên đội khách KHÔNG bị nuốt phần tỷ số"
  );

  const aet = parsed[1];
  check(
    JSON.stringify(aet?.extraTime) === "[3,2]" && JSON.stringify(aet?.fullTime) === "[3,0]",
    "dòng hiệp phụ: số dẫn đầu là tỷ số 120 phút, ngoặc đầu là phút 90"
  );

  // Tên đội có chữ số ("Bayer 04", "1. FC") là chỗ dễ cắt nhầm nhất.
  check(
    parsed[2]?.home === "Bayer 04 Leverkusen (GER)" && parsed[2]?.away === "1. FC Union Berlin (GER)",
    "tên đội chứa chữ số không bị cắt thành tỷ số"
  );

  check(
    splitTeam("Paris Saint-Germain FC (FRA)  1-4 pen. 0-1 a.e.t. (0-1, 0-1)") === null,
    "phép dò tên hỏng KÊU khi đưa vào đúng cái tên hỏng cũ"
  );
  check(splitTeam("Arsenal FC (ENG)")?.club === "Arsenal FC", "và KHÔNG kêu với tên bình thường");
  check(
    classifyStage("Gruppe H") === "group" && classifyStage("Coupe de France") === null,
    "nhãn vòng tiếng Đức xếp được, nhãn lạ thì trả null"
  );
  check(
    usablePenalties([4, 4]) === null && JSON.stringify(usablePenalties([1, 4])) === "[1,4]",
    "loạt luân lưu hoà bị loại, luân lưu thật thì giữ"
  );

  // Trận chung kết mà ĐỘI KHÁCH vô địch — ca duy nhất cần đảo, và ca tôi đã
  // dựng sai lần đầu: bảng ghi "Chelsea vô địch" cạnh tỷ số luân lưu "3-4".
  const awayWinsFinal = {
    round: "Final",
    date: "2012-05-19",
    stage: "final" as const,
    home: "Bayern München (GER)",
    away: "Chelsea FC (ENG)",
    homeClub: "Bayern München",
    homeCountry: "GER",
    awayClub: "Chelsea FC",
    awayCountry: "ENG",
    fullTime: [1, 1] as [number, number],
    halfTime: [0, 0] as [number, number],
    extraTime: [1, 1] as [number, number],
    penalties: [3, 4] as [number, number],
    winner: "away" as const,
    decidedBy: "pen" as const,
  };
  check(
    finalScoreLabel(awayWinsFinal) === "1-1 (luân lưu 4-3)",
    `tỷ số chung kết xoay về phía nhà vô địch (${finalScoreLabel(awayWinsFinal)})`
  );
  check(
    finalScoreLabel({ ...awayWinsFinal, winner: "home", penalties: [4, 3] }) === "1-1 (luân lưu 4-3)",
    "và KHÔNG đảo khi nhà vô địch là chủ nhà"
  );
}

/**
 * Tỷ số chung kết phải đọc được theo thứ tự cột: vô địch trước, á quân sau.
 *
 * Bất biến: số đầu >= số sau ở tỷ số, và > ở loạt luân lưu (luân lưu không
 * hoà). Một bảng ghi "Chelsea vô địch ... 3-4" thoả mọi phép kiểm về SỐ, nên
 * chỉ phép kiểm về THỨ TỰ mới bắt được.
 */
function checkFinalLabel(label: string | null, where: string): void {
  if (label === null) {
    check(false, `${where}: không dựng được tỷ số chung kết`);
    return;
  }
  const score = /^(\d+)-(\d+)/.exec(label);
  const pen = /luân lưu (\d+)-(\d+)/.exec(label);
  const scoreOk = score !== null && Number(score[1]) >= Number(score[2]);
  const penOk = pen === null || Number(pen[1]) > Number(pen[2]);
  check(scoreOk && penOk, `${where}: tỷ số chung kết đọc theo phía vô địch ("${label}")`);
}

function checkSeason(s: UclSeason): void {
  const label = `${s.season} (${s.source})`;

  // Cộng theo ĐỘI, không theo vế chủ/khách. Tổng bàn ghi của vế chủ KHÔNG
  // bằng tổng bàn ghi của vế khách — đội nhà thắng nhiều hơn, đó là lợi thế
  // sân nhà chứ không phải lỗi. Bất biến thật là: mỗi bàn được đếm đúng một
  // lần cho bên ghi và một lần cho bên thủng.
  const forGoals = new Map<string, number>();
  const againstGoals = new Map<string, number>();
  const appearances = new Map<string, number>();
  const bump = (map: Map<string, number>, k: string, n: number) => map.set(k, (map.get(k) ?? 0) + n);

  let monotone = true;
  let penOk = true;
  for (const m of s.matches) {
    bump(appearances, m.home, 1);
    bump(appearances, m.away, 1);
    if (m.fullTime) {
      bump(forGoals, m.home, m.fullTime[0]);
      bump(againstGoals, m.home, m.fullTime[1]);
      bump(forGoals, m.away, m.fullTime[1]);
      bump(againstGoals, m.away, m.fullTime[0]);
    }
    const { halfTime: ht, fullTime: ft, extraTime: et } = m;
    for (const i of [0, 1] as const) {
      if (ht && ft && ht[i] > ft[i]) monotone = false;
      if (ft && et && ft[i] > et[i]) monotone = false;
    }
    if (m.penalties && m.penalties[0] === m.penalties[1]) penOk = false;
  }

  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const totalFor = sum(forGoals);
  const totalAppearances = sum(appearances);

  check(s.played === s.matches.length, `${label}: ${s.played}/${s.matches.length} trận có tỷ số`);
  check(monotone, `${label}: bàn thắng không giảm qua hiệp một -> 90' -> 120'`);
  check(
    totalFor === sum(againstGoals) && totalFor === s.goals,
    `${label}: mỗi bàn đếm đúng một lần cho hai phía (${totalFor} bàn)`
  );
  check(
    totalAppearances === s.matches.length * 2,
    `${label}: mỗi trận đúng hai đội (${totalAppearances} lượt / ${s.matches.length} trận)`
  );
  check(penOk, `${label}: không có loạt luân lưu hoà`);
  check(s.final !== null && s.champion !== null, `${label}: có chung kết và xác định được nhà vô địch`);

  if (s.final) checkFinalLabel(finalScoreLabel(s.final), label);

  const want = CHAMPIONS[s.season];
  if (want) {
    check(
      s.champion?.includes(want) === true,
      `${label}: vô địch = ${s.champion ?? "?"} (đối chiếu thực tế: ${want})`
    );
  } else {
    console.log(`    · ${label}: vô địch ${s.champion} — không có trong bảng viết tay, không đối chiếu được`);
  }
}

async function main() {
  console.log(`\n=== Kho lưu trữ Champions League — ${UCL_ARCHIVE_SEASONS.length} mùa ===\n`);

  selfTest();

  console.log("\n  danh sách mùa");
  const years = UCL_ARCHIVE_SEASONS.map((s) => Number(s.slice(0, 4)));
  const gaps = years.filter((y, i) => i > 0 && y !== years[i - 1] + 1);
  check(
    UCL_ARCHIVE_SEASONS.length === 15,
    `15 mùa: ${UCL_ARCHIVE_SEASONS[0]} … ${UCL_ARCHIVE_SEASONS.at(-1)}`
  );
  check(gaps.length === 0, "liên tiếp, không đứt quãng");

  console.log("\n  từng mùa");
  const seasons = await Promise.all(UCL_ARCHIVE_SEASONS.map((s) => fetchUclSeason(s)));
  for (const s of seasons) checkSeason(s);

  console.log("\n  đối chiếu chéo 2024-25 — mùa duy nhất có CẢ HAI nguồn");
  const [tx, js] = await Promise.all([
    fetchUclSeason("2024-25", "txt"),
    fetchUclSeason("2024-25", "json"),
  ]);
  const key = (m: { round: string; home: string; away: string }) => `${m.round} ${m.home} ${m.away}`;
  const byKey = new Map(js.matches.map((m) => [key(m), m]));
  check(
    new Set(tx.matches.map(key)).size === tx.matches.length,
    `khoá (vòng, chủ, khách) duy nhất ở cả ${tx.matches.length} trận — khoá chỉ theo cặp đội thì KHÔNG`
  );

  // HAI chuyện khác hẳn nhau, và gộp chúng lại thì mất cả hai. "Nguồn kia bỏ
  // trống" là một lỗ hổng phủ sóng; "hai nguồn khai hai số khác nhau" nghĩa
  // là ít nhất một bên SAI. Chỉ cái thứ hai mới đáng làm đỏ cổng.
  let same = 0;
  let missing = 0;
  const blank: string[] = [];
  const contradiction: string[] = [];
  for (const t of tx.matches) {
    const j = byKey.get(key(t));
    if (!j) {
      missing++;
      continue;
    }
    const a = JSON.stringify([t.fullTime, t.halfTime, t.extraTime]);
    const b = JSON.stringify([j.fullTime, j.halfTime, j.extraTime]);
    if (a === b) same++;
    else if (j.fullTime === null) blank.push(`${t.home} v ${t.away}: .txt ${a}, .json bỏ trống`);
    else contradiction.push(`${t.home} v ${t.away}: .txt ${a} / .json ${b}`);
  }
  check(missing === 0, `mọi trận .txt tìm được trong .json (${tx.matches.length} trận)`);
  check(contradiction.length === 0, `không có trận nào hai nguồn khai hai tỷ số khác nhau (${same} trận khớp)`);
  for (const d of contradiction.slice(0, 5)) console.log(`        ${d}`);
  for (const d of blank) console.log(`    · ${d}`);

  console.log("\n  khiếm khuyết của nguồn, ghi ra chứ không sửa");
  for (const s of [...seasons, js]) {
    for (const d of s.defects) console.log(`    · ${s.season} (${s.source}): ${d}`);
  }

  console.log("\n  quy mô việc gộp tên đội xuyên mùa (chưa làm, cố ý)");
  const names = new Set(seasons.flatMap((s) => s.teams));
  const clubs = [...new Set([...names].map((n) => splitTeam(n)?.club ?? n))].sort();
  // Ước lượng dưới, không phải con số đúng: đếm cặp mà tên này là tiền tố của
  // tên kia ("Real Madrid" / "Real Madrid CF"). Nó bỏ sót mọi cặp đổi tên
  // theo kiểu khác ("Inter" / "FC Internazionale Milano"), nên số thật lớn
  // hơn. Đưa ra để biết việc gộp to cỡ nào, KHÔNG phải để dùng thay việc gộp.
  const prefixPairs = clubs.filter((c, i) =>
    clubs.some((d, k) => k !== i && (d.startsWith(`${c} `) || c.startsWith(`${d} `)))
  );
  console.log(`    ${names.size} chuỗi tên đội trong 15 mùa, ${clubs.length} sau khi bỏ hậu tố nước`);
  console.log(`    ít nhất ${prefixPairs.length} chuỗi là tên khác của một CLB đã có: ${prefixPairs.slice(0, 6).join(", ")}`);

  console.log("\n  tổng");
  const totalMatches = seasons.reduce((n, s) => n + s.matches.length, 0);
  const totalGoals = seasons.reduce((n, s) => n + s.goals, 0);
  console.log(
    `    ${totalMatches} trận, ${totalGoals} bàn, ` +
      `${UCL_JSON_SEASONS.length} mùa từ JSON + ${UCL_TXT_SEASONS.length} mùa từ .txt`
  );

  console.log(failed === 0 ? "\n✓ Tất cả phép kiểm xanh.\n" : `\n✗ ${failed} phép kiểm đỏ.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
