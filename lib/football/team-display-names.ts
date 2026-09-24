/**
 * Tên ĐỘI hiển thị cho người đọc Việt Nam, thay cho tên nguyên văn openfootball.
 *
 * ═══ VÌ SAO TỒN TẠI ═══
 *
 * openfootball trả tên đăng ký chính thức — "Manchester United FC",
 * "Tottenham Hotspur FC". Người Việt không gõ những chuỗi đó. Đo 24/9/2026
 * (DataForSEO, location 2704, language vi, `search_volume` + KD):
 *
 *     mu                       1.000.000   KD 26
 *     manchester united          450.000   KD 51
 *     manchester united fc         5.400   KD 71
 *
 *     tottenham                  135.000
 *     tottenham hotspur            1.900
 *
 * `mu` so với `manchester united fc`: gấp **185 lần** lượt tìm ở **một phần
 * ba** độ khó. Tên openfootball là lựa chọn TỆ NHẤT trong các biến thể.
 *
 * ═══ CHỈ ĐỔI CHỮ HIỂN THỊ, KHÔNG ĐỔI KHOÁ ═══
 *
 * `teamSlug()` và `teamKey()` không đọc bảng này. URL giữ nguyên
 * `/bong-da-nam/en-1/manchester-united-fc`, và đó là cố ý: đổi khoá là đổi
 * URL của 96 trang đội cộng 876 trang cặp, và bảng này không có bằng chứng
 * nào nói URL đang sai. Nó chỉ có bằng chứng nói CHỮ đang sai.
 *
 * ═══ VÌ SAO CHỈ 12 ĐỘI, KHÔNG PHẢI 96 ═══
 *
 * Vì chỉ 12 đội có bằng chứng. Phép sinh ứng viên cơ học cộng luật "volume
 * cao nhất" đẻ ra ba tên SAI trên chính bộ 263 ứng viên đã đo:
 *
 *     1. FC Union Berlin  ->  "berlin"      8.100   thành phố
 *     Hamburger SV        ->  "hamburger"  33.100   món ăn, KD 0
 *     RCD Espanyol        ->  "barcelona"  14.800   CLB KHÁC HẲN
 *
 * Chuỗi ngắn mơ hồ mượn volume của thực thể khác. Hỏi lại trong ngữ cảnh
 * bóng đá ("lịch thi đấu X") khử được ở CLB lớn — `hamburger sv` và `berlin`
 * về không-có-dữ-liệu — nhưng ở CLB nhỏ mọi số đều dưới 100, quá nhiễu để
 * chọn.
 *
 * Nên 84 đội còn lại giữ tên openfootball: sai theo hướng AN TOÀN, cùng
 * nguyên tắc `NICHES_WITH_COPY` bên publisher. Một tên đúng-nhưng-dài kém
 * hơn một tên ngắn-và-đúng, nhưng tốt hơn RẤT NHIỀU so với một tên ngắn và
 * sai — trang "Barcelona" cho Espanyol thì mọi con số trên đó vẫn đúng, và
 * không cổng nào bắt được.
 *
 * ═══ KHOÁ LÀ CHUỖI CHÍNH XÁC, KHÔNG PHẢI CHUỖI CON ═══
 *
 * Ligue 1 có CẢ `Paris FC` lẫn `Paris Saint-Germain FC`. Khớp theo chuỗi con
 * "Paris" trúng cả hai và gán "PSG" cho một CLB không phải PSG. Bảng này
 * khớp nguyên văn, và `verify-team-display-names.ts` đỏ khi một khoá ở đây
 * không còn tồn tại trong nguồn — vì một khoá viết sai chính tả thì KHÔNG
 * khớp gì cả, không đổi gì cả, và không có gì đỏ lên.
 */
export const TEAM_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  // Ngoại hạng Anh
  "Manchester United FC": "MU",
  "Manchester City FC": "Man City",
  "Arsenal FC": "Arsenal",
  "Chelsea FC": "Chelsea",
  "Liverpool FC": "Liverpool",
  "Tottenham Hotspur FC": "Tottenham",
  "Aston Villa FC": "Aston Villa",
  // La Liga — CHỈ FC Barcelona. "RCD Espanyol de Barcelona" cố ý KHÔNG có
  // mặt ở đây; xem khối chú thích trên.
  "FC Barcelona": "Barca",
  "Real Madrid CF": "Real Madrid",
  // Bundesliga
  "FC Bayern München": "Bayern Munich",
  // Serie A
  "Juventus FC": "Juventus",
  // Ligue 1 — KHÔNG phải "Paris FC", đó là CLB khác.
  "Paris Saint-Germain FC": "PSG",
};

/** Chữ hiển thị của một đội. Không có trong bảng thì giữ nguyên tên nguồn. */
export function teamDisplayName(sourceName: string): string {
  return TEAM_DISPLAY_NAMES[sourceName] ?? sourceName;
}
