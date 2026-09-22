/**
 * Trục trang của một site KHÔNG có địa lý: axis nào tồn tại, khoá dựng ra sao.
 *
 * ═══ VÌ SAO TẬP `axis` SỐNG Ở ĐÂY CHỨ KHÔNG Ở DATABASE ═══
 *
 * `vertical` đọc TỪ dữ liệu, vì tập nghề do file coverage quyết định và một
 * danh sách viết tay ở đây sẽ là định nghĩa thứ hai (xem
 * `lib/queries/verticals.ts`). `axis` thì ngược lại: không nguồn dữ liệu nào
 * phát ra khái niệm "trang đội", nó là quyết định của mã. Đọc nó từ database
 * sẽ là đọc lại chính thứ mã này vừa ghi vào — một vòng lặp trông như một
 * phép kiểm.
 *
 * Nên tập giá trị khai ở đây, và `scripts/verify-page-axis.ts` đỏ khi
 * database chứa một `axis` không ai khai. Chiều kiểm là DB → mã, không phải
 * ngược lại.
 *
 * ═══ FILE NÀY PHẢI THUẦN ═══
 *
 * Không Next, không Prisma, không fetch. Cùng ràng buộc với `lib/football/`
 * và cùng lý do: `scripts/verify-page-axis.ts` chạy bằng `tsx` thuần, ngoài
 * Next. Thêm một import của Next vào đây là đánh sập cổng canh, và thông báo
 * lỗi lúc ấy sẽ nói về module chứ không nói về import vừa thêm.
 */

/** Nghề duy nhất của thị trường Việt Nam — bóng đá nam. */
export const FOOTBALL_VERTICAL = "bong-da-nam";

/**
 * `axis` KHÔNG được phép mang giá trị này.
 *
 * Trục địa lý có danh tính riêng (`Location`, `MarketIdentity`) và đang phục
 * vụ hai site sống. Một hàng `EntityIdentity` mang `axis = "zip"` nghĩa là
 * cùng một trang có hai danh tính ở hai bảng, và không có cách nào để hai bên
 * biết về nhau — đó đúng là bản sao trôi lệch mà việc tách bảng đã chấp nhận
 * đánh đổi. Chấp nhận cái giá đó thì phải canh đúng chỗ nó phát sinh.
 */
export const RESERVED_AXES: readonly string[] = ["zip", "cluster"];

export interface AxisDef {
  axis: string;
  /** Chữ người đọc thấy khi trang này được nhắc tới trong breadcrumb. */
  label: string;
  /** Axis của trang cha. null = gốc của cây. */
  parentAxis: string | null;
  /** Một câu nói trang này được phép khẳng định điều gì. Viết cho người,
   *  cùng tinh thần với `says` của `NicheSection`. */
  says: string;
}

export const AXES_BY_VERTICAL: Record<string, readonly AxisDef[]> = {
  [FOOTBALL_VERTICAL]: [
    {
      axis: "league",
      label: "Giải đấu",
      parentAxis: null,
      says:
        "Bảng xếp hạng và số liệu tổng hợp của giải tính TỪ các trận đã đá của mùa đang diễn ra. " +
        "Không lấy bảng từ nguồn thứ hai — xem buildStandings().",
    },
    {
      axis: "team",
      label: "Đội",
      parentAxis: "league",
      says:
        "Số liệu của MỘT đội trong giải của nó: vị trí, phong độ N trận gần nhất, tách sân nhà/sân " +
        "khách, giữ sạch lưới, bàn theo hiệp, chuỗi. Tất cả suy từ kết quả trận, không có dữ liệu cầu thủ.",
    },
    {
      axis: "fixture",
      label: "Đối đầu",
      parentAxis: "league",
      says:
        "Lịch sử đối đầu giữa HAI đội trong cùng giải, trên tập mùa đang có. Cặp KHÔNG phân biệt " +
        "chủ-khách — xem fixtureKey().",
    },
  ],
};

export function axesFor(vertical: string): readonly AxisDef[] {
  return AXES_BY_VERTICAL[vertical] ?? [];
}

export function isKnownAxis(vertical: string, axis: string): boolean {
  return axesFor(vertical).some((a) => a.axis === axis);
}

/**
 * Tên đội → đoạn đường dẫn.
 *
 * Bỏ dấu bằng NFD rồi cắt dải kết hợp, nên "Atlético" → "atletico" và
 * "Bayern München" → "bayern-munchen". Vài chữ KHÔNG phân tách được bằng NFD
 * — ø, đ, ß, æ không mang dấu kết hợp mà là ký tự riêng — nên chúng phải khai
 * tay. Thiếu bảng đó thì chúng bị lọc rụng và "Køge" thành "kge".
 *
 * KHÔNG dùng để so sánh hay ghép dữ liệu: khoá ghép giữa hai nguồn
 * openfootball là CẶP ĐỘI theo tên nguyên văn (xem fetchLeagueSeasonMerged).
 * Hàm này chỉ dựng URL. Hai vai trò đó tách nhau vì slug làm mất thông tin, và
 * một phép ghép trên dữ liệu đã mất thông tin sẽ hỏng im lặng.
 */
const LETTER_MAP: Record<string, string> = {
  ø: "o", Ø: "o", đ: "d", Đ: "d", ß: "ss", æ: "ae", Æ: "ae",
  œ: "oe", Œ: "oe", å: "a", Å: "a", ł: "l", Ł: "l", þ: "th", Þ: "th", ð: "d", Ð: "d",
};

export function teamSlug(name: string): string {
  const mapped = [...name].map((ch) => LETTER_MAP[ch] ?? ch).join("");
  return mapped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Mã giải openfootball ("en.1") → đoạn đường dẫn ("en-1"). Dấu chấm trong
 *  một segment URL hợp lệ nhưng đọc như phần mở rộng file, và middleware ở
 *  biên phân biệt tài nguyên gốc bằng đúng hình dạng đó. */
export function leagueSlug(code: string): string {
  return code.replace(/\./g, "-");
}

export function leagueKey(code: string): string {
  return leagueSlug(code);
}

export function teamKey(code: string, teamName: string): string {
  return `${leagueSlug(code)}/${teamSlug(teamName)}`;
}

/**
 * Khoá trang đối đầu. CẶP KHÔNG THỨ TỰ, và đó là điều phải giữ.
 *
 * Arsenal-Chelsea và Chelsea-Arsenal là CÙNG một cặp đối đầu; giải vòng tròn
 * hai lượt cho mỗi cặp đúng hai trận, mỗi đội làm chủ nhà một lần. Sinh hai
 * trang theo hai thứ tự sẽ ra hai URL mang gần như cùng một nội dung — nội
 * dung trùng lặp do chính mình tạo ra, trên đúng loại trang mà brief nói là
 * phần xếp hạng được lâu dài.
 *
 * Sắp xếp làm tính KHÔNG THỨ TỰ trở thành tính chất của hàm chứ không phải
 * một quy ước người gọi phải nhớ. Đếm được: C(20,2)=190 mỗi giải 20 đội,
 * C(18,2)=153 mỗi giải 18 đội → 190×3 + 153×2 = 876, khớp con số đo được ở
 * brief mục 4.1.
 */
export function fixtureKey(code: string, teamA: string, teamB: string): string {
  const [a, b] = [teamSlug(teamA), teamSlug(teamB)].sort();
  return `${leagueSlug(code)}/${a}__${b}`;
}

export interface ParsedKey {
  axis: string;
  leagueSlug: string;
  /** Có với axis "team". */
  team?: string;
  /** Có với axis "fixture", đã sắp xếp. */
  pair?: [string, string];
}

/**
 * Đọc ngược một `key`. Trả null khi chuỗi không thuộc trục này.
 *
 * null chứ không ném: người gọi là route, và một đoạn đường dẫn do người lạ gõ
 * phải ra 404 chứ không ra lỗi 500.
 */
export function parseKey(key: string): ParsedKey | null {
  const parts = key.split("/");
  if (parts.length === 1 && parts[0]) return { axis: "league", leagueSlug: parts[0] };
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [league, tail] = parts;
  if (tail.includes("__")) {
    const pair = tail.split("__");
    if (pair.length !== 2 || !pair[0] || !pair[1]) return null;
    // Khoá không chuẩn tắc (chưa sắp xếp) KHÔNG được coi là hợp lệ: chấp nhận
    // nó nghĩa là hai URL cùng phục vụ một trang, đúng thứ fixtureKey chống.
    if (pair[0] >= pair[1]) return null;
    return { axis: "fixture", leagueSlug: league, pair: [pair[0], pair[1]] };
  }
  return { axis: "team", leagueSlug: league, team: tail };
}
