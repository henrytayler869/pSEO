import { unstable_cache } from "next/cache";
import { LEAGUES, fetchLeagueSeasonMerged, buildStandings, type LeagueCode } from "./openfootball";
import { UCL_ARCHIVE_SEASONS, fetchUclSeason, finalScoreLabel } from "./ucl-archive";
import { currentEuropeanSeason } from "./season";

/**
 * Lớp đệm cho trang, và nó nằm RIÊNG một file có lý do.
 *
 * ═══ VÌ SAO KHÔNG ĐỂ TRONG `openfootball.ts` ═══
 *
 * `scripts/verify-openfootball.ts` và `scripts/verify-ucl-archive.ts` chạy
 * bằng `tsx` thuần, ngoài Next. Chúng import trực tiếp hai file lib kia. Đặt
 * bất cứ thứ gì của Next vào đó là đánh sập cả hai cổng canh — đã gặp đúng
 * kiểu này rồi: một module `use cache` bị `tsx` nạp sẽ ném
 * ERR_REQUIRE_ASYNC_MODULE, và thông báo đó không nhắc gì tới caching.
 *
 * Nên biên giới là: lib football KHÔNG biết gì về Next, file này là chỗ duy
 * nhất biết. Script không bao giờ import file này.
 *
 * ═══ VÌ SAO `unstable_cache` MÀ KHÔNG PHẢI `use cache` ═══
 *
 * Next 16 khuyên dùng `use cache`, nhưng nó đòi bật cờ `cacheComponents` —
 * một cờ đổi ngữ nghĩa render của TOÀN BỘ app, không phải của riêng trang
 * này. Đổi nó để thêm một dropdown là lấy rủi ro ở 20 trang khác để đỡ một
 * dòng deprecated ở đây. Tài liệu trong `node_modules/next/dist/docs` có hẳn
 * một hướng dẫn cho dự án chưa bật cờ đó, và `unstable_cache` là đường nó
 * chỉ.
 *
 * ═══ HAI THỜI HẠN, VÌ HAI LOẠI DỮ LIỆU ═══
 *
 * Mùa đang đá thì đổi mỗi vòng: 1 giờ. Mùa đã kết thúc thì KHÔNG đổi nữa:
 * 24 giờ. Cùng một thời hạn cho cả hai nghĩa là hoặc tải lại 15 mùa bất biến
 * mỗi giờ, hoặc để kết quả mới cũ mất một ngày.
 *
 * ═══ LỖI MẠNG KHÔNG ĐƯỢC LÀM SẬP TRANG ═══
 *
 * Nguồn là GitHub raw, và nó có lúc không tới được — đã gặp trên chính máy
 * này. Mỗi giải bọc riêng: một giải tịt thì bốn giải kia vẫn hiện, và ô của
 * nó nói rõ "không tải được" thay vì hiện số 0 trông như "chưa đá trận nào".
 * Hai thứ đó khác nhau hoàn toàn, và một ô trống thì không phân biệt được.
 */

export interface LeagueCard {
  code: LeagueCode;
  label: string;
  season: string;
  teams: number | null;
  matches: number | null;
  played: number | null;
  lastResultDate: string | null;
  stalenessDays: number | null;
  overlaid: number;
  conflicts: number;
  unmatched: number;
  overlaySource: "txt" | "none";
  leader: string | null;
  /** null = tải được. Có chuỗi = KHÔNG tải được, và đây là lý do. */
  error: string | null;
}

async function loadLeague(code: LeagueCode, season: string, nowMs: number): Promise<LeagueCard> {
  const base: LeagueCard = {
    code,
    label: LEAGUES[code],
    season,
    teams: null,
    matches: null,
    played: null,
    lastResultDate: null,
    stalenessDays: null,
    overlaid: 0,
    conflicts: 0,
    unmatched: 0,
    overlaySource: "none",
    leader: null,
    error: null,
  };
  try {
    const s = await fetchLeagueSeasonMerged(code, season, new Date(nowMs));
    const table = buildStandings(s);
    return {
      ...base,
      teams: s.teams.length,
      matches: s.matches.length,
      played: s.played,
      lastResultDate: s.lastResultDate,
      stalenessDays: s.stalenessDays,
      overlaid: s.overlaid,
      conflicts: s.conflicts.length,
      unmatched: s.unmatched.length,
      overlaySource: s.overlaySource,
      leader: s.played > 0 ? (table[0]?.team ?? null) : null,
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `nowMs` là THAM SỐ, không đọc `Date.now()` bên trong.
 *
 * `unstable_cache` sinh khoá từ đối số. Đọc đồng hồ bên trong thì `stalenessDays`
 * bị đóng băng theo lần tính đầu tiên: một ô "trễ 1 ngày" sẽ vẫn ghi "1 ngày"
 * sau khi đã trễ ba ngày. Làm tròn xuống giờ để khoá không đổi mỗi
 * millisecond mà vẫn theo được thời gian thật.
 */
const cachedLeagues = unstable_cache(
  async (season: string, nowMs: number): Promise<LeagueCard[]> => {
    const codes = Object.keys(LEAGUES) as LeagueCode[];
    return Promise.all(codes.map((c) => loadLeague(c, season, nowMs)));
  },
  ["vn-football-leagues"],
  { revalidate: 3600, tags: ["vn-football"] }
);

export async function getLeagueCards(now: Date): Promise<LeagueCard[]> {
  const hour = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  return cachedLeagues(currentEuropeanSeason(now), hour);
}

export interface UclSeasonCard {
  season: string;
  source: "json" | "txt";
  matches: number;
  goals: number;
  champion: string | null;
  runnerUp: string | null;
  /** "1-1 (luân lưu 4-3)", đã xoay về phía nhà vô địch — xem `finalScoreLabel`. */
  finalScore: string | null;
  error: string | null;
}

const cachedUcl = unstable_cache(
  async (): Promise<UclSeasonCard[]> =>
    Promise.all(
      UCL_ARCHIVE_SEASONS.map(async (season): Promise<UclSeasonCard> => {
        try {
          const s = await fetchUclSeason(season);
          return {
            season,
            source: s.source,
            matches: s.matches.length,
            goals: s.goals,
            champion: s.champion,
            runnerUp: s.runnerUp,
            finalScore: finalScoreLabel(s.final),
            error: null,
          };
        } catch (e) {
          return {
            season,
            source: "txt",
            matches: 0,
            goals: 0,
            champion: null,
            runnerUp: null,
            finalScore: null,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })
    ),
  ["ucl-archive"],
  // 24 giờ: 15 mùa này đã kết thúc và không đổi nữa. Vẫn không phải vô hạn —
  // nguồn có sửa lại file sau khi mùa xong (đã thấy một lần, 2/7/2026).
  { revalidate: 86_400, tags: ["ucl-archive"] }
);

export async function getUclArchive(): Promise<UclSeasonCard[]> {
  return cachedUcl();
}
