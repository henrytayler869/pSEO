/**
 * Sinh danh sách ỨNG VIÊN tên đội để đo cầu, rồi in ra cho probe-keywords.
 *
 *     tsx scripts/probe-team-names.ts > /tmp/team-candidates.txt
 *     tsx scripts/probe-keywords.ts --location 2704 --language vi --file /tmp/team-candidates.txt
 *
 * ═══ VÌ SAO KHÔNG VIẾT THẲNG TÊN NGẮN VÀO MÃ ═══
 *
 * Câu hỏi "người Việt gọi đội này là gì" là câu hỏi ĐO ĐƯỢC, và kho này có
 * cả một tầng validator tồn tại vì đúng cám dỗ ngồi tự điền. Tôi biết
 * "Manchester United" hay được gọi là "MU" — nhưng biết không phải đo, và
 * 96 đội thì cái biết ấy mỏng dần rất nhanh (Mainz? Getafe? Lecce?).
 *
 * Nên script này chỉ sinh GIẢ THUYẾT. Số liệu chọn người thắng:
 *
 *   1. tên nguyên văn openfootball       "Tottenham Hotspur FC"
 *   2. bỏ đuôi/đầu chỉ loại hình CLB     "Tottenham Hotspur"
 *   3. từ đầu tiên                       "Tottenham"
 *   4. viết tắt tiếng Việt ĐÃ BIẾT       "mu"   (chỉ những CLB có tên tắt phổ thông)
 *
 * Nhóm 4 vẫn là giả thuyết, không phải khẳng định: nó được ĐO cùng ba nhóm
 * kia, và nếu volume của nó thấp hơn thì nó thua. Đo 24/9/2026 đã cho thấy
 * chiều ngược lại cũng xảy ra: "Tottenham Hotspur" trả **0** trong khi đó là
 * một CLB lớn — tức tên chính thức mới là cái sai.
 *
 * KHÔNG đưa "lịch thi đấu X" hay "bảng xếp hạng X" vào đây. Đó là đo nhánh
 * Ý ĐỊNH, không phải đo CÁI TÊN, và trộn hai câu hỏi vào một phép đo sẽ cho
 * một bảng không trả lời được câu nào.
 */
import { prisma } from "@/lib/db/prisma";
import { FOOTBALL_VERTICAL } from "@/lib/page-axis/axes";

/** Từ chỉ loại hình CLB, bỏ đi để lấy phần tên riêng. Cắt ở HAI đầu: "FC
 *  Bayern München" và "Tottenham Hotspur FC" cùng một bệnh, khác phía. */
const CLUB_WORDS = new Set([
  "fc", "afc", "cf", "sc", "ac", "as", "ss", "ssc", "sv", "tsg", "vfb", "vfl",
  "bsc", "fsv", "rc", "rcd", "ud", "cd", "sd", "us", "usl", "calcio", "club",
  "cp", "spal", "hsv", "bv", "borussia", "real", "athletic", "atletico",
]);

/**
 * Viết tắt phổ thông trong tiếng Việt, theo tên nguyên văn openfootball.
 *
 * Bảng NGẮN có chủ ý: chỉ những CLB mà tên tắt là thứ thật sự phổ thông ở
 * thị trường này. Thêm bừa vào đây là quay lại đúng việc tự điền mà cả
 * script này sinh ra để tránh — một mục sai sẽ được ĐO, và nếu nó tình cờ
 * có volume vì trùng chữ khác thì nó thắng oan.
 */
const KNOWN_SHORT: Record<string, readonly string[]> = {
  "Manchester United FC": ["mu", "man utd"],
  "Manchester City FC": ["man city"],
  "Tottenham Hotspur FC": ["tottenham", "spurs"],
  "Real Madrid CF": ["real madrid"],
  "FC Barcelona": ["barca", "barcelona"],
  "Club Atlético de Madrid": ["atletico madrid"],
  "FC Bayern München": ["bayern munich", "bayern"],
  "Borussia Dortmund": ["dortmund"],
  "Inter Milan": ["inter milan", "inter"],
  "FC Internazionale Milano": ["inter milan", "inter"],
  "AC Milan": ["ac milan", "milan"],
  "Juventus FC": ["juventus", "juve"],
  "Paris Saint-Germain FC": ["psg"],
  "Liverpool FC": ["liverpool"],
  "Arsenal FC": ["arsenal"],
  "Chelsea FC": ["chelsea"],
  "Newcastle United FC": ["newcastle"],
  "West Ham United FC": ["west ham"],
};

/**
 * Token là chữ chỉ loại hình CLB, hoặc số thứ tự / năm thành lập.
 *
 * Phần SỐ không phải tô vẽ. "1. FC Köln" mở đầu bằng `1.`, và nếu chỉ cắt
 * theo CLUB_WORDS thì vòng lặp dừng ngay ở token đầu — không bao giờ sinh ra
 * ứng viên `köln`, tức đúng cái tên người ta gõ thì không được đo. Cùng bệnh:
 * "1. FSV Mainz 05" (`mainz`), "FC Schalke 04", "Bayer 04 Leverkusen".
 *
 * Đây là lỗi tôi bắt được bằng cách ĐỌC danh sách sinh ra trước khi tiêu
 * tiền đo, chứ không phải bằng một phép kiểm — 219 dòng vẫn vừa mắt người.
 */
function isDroppableToken(token: string): boolean {
  const t = token.toLowerCase().replace(/\./g, "");
  return CLUB_WORDS.has(t) || /^\d{1,4}$/.test(t);
}

function stripClubWords(name: string): string {
  const parts = name.split(/\s+/);
  while (parts.length > 1 && isDroppableToken(parts[0])) parts.shift();
  while (parts.length > 1 && isDroppableToken(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/**
 * Ứng viên tên của MỘT đội. Export để `choose-team-names.ts` ghép số đo vào
 * đúng đội — hai nơi phải sinh CÙNG một tập, nếu không thì bảng đề xuất sẽ
 * ghép số của ứng viên này vào đội kia và không có gì đỏ lên.
 */
export function candidatesFor(displayName: string): string[] {
  const out = new Set<string>();
  {
    out.add(displayName.toLowerCase());
    const stripped = stripClubWords(displayName);
    if (stripped) out.add(stripped.toLowerCase());

    /**
     * Bỏ token rác ở GIỮA, không chỉ ở hai đầu.
     *
     * "Bayer 04 Leverkusen" có số nằm giữa, nên phép cắt hai đầu trả lại
     * nguyên chuỗi và ứng viên duy nhất sinh thêm là từ đầu — `bayer`, vốn
     * là một hãng dược. Nó SẼ có volume, và volume đó không phải của đội
     * bóng. Một ứng viên sai mà có số là tệ hơn một ứng viên thiếu.
     */
    const core = displayName.split(/\s+/).filter((t) => !isDroppableToken(t));
    if (core.length > 0) out.add(core.join(" ").toLowerCase());

    const words = stripped.split(/\s+/);
    // Từ ĐẦU và từ CUỐI đều là ứng viên: tên nhận diện nằm đầu ở
    // "Tottenham Hotspur" nhưng nằm cuối ở "Bayer 04 Leverkusen".
    for (const w of [words[0], words[words.length - 1]]) {
      if (w && w.replace(/\./g, "").length > 2) out.add(w.toLowerCase());
    }
    for (const s of KNOWN_SHORT[displayName] ?? []) out.add(s.toLowerCase());
  }
  return [...out];
}

async function main(): Promise<void> {
  const rows = await prisma.entityIdentity.findMany({
    where: { vertical: FOOTBALL_VERTICAL, axis: "team" },
    select: { displayName: true },
    orderBy: { key: "asc" },
  });
  if (rows.length === 0) throw new Error("Không hàng đội nào. Chạy `npm run football:sync` trước.");

  const out = new Set<string>();
  for (const { displayName } of rows) for (const c of candidatesFor(displayName)) out.add(c);

  console.error(`# ${rows.length} đội -> ${out.size} ứng viên`);
  for (const k of out) console.log(k);
}

/**
 * Chỉ chạy khi được GỌI THẲNG, không chạy khi bị import.
 *
 * `choose-team-names.ts` import `candidatesFor` từ đây; không có cửa này thì
 * việc import sẽ kéo theo một lượt truy vấn database và in cả danh sách ứng
 * viên ra stdout, lẫn vào chính bảng kết quả nó đang dựng.
 */
if (process.argv[1]?.includes("probe-team-names")) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
