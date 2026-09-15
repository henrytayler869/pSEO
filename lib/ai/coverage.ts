import { prisma } from "@/lib/db/prisma";
import { getCachedInterpretation } from "@/lib/ai/generate";
import { getCachedClusterText } from "@/lib/ai/cluster-generate";
import { clusterIdOf } from "@/lib/ai/cluster-facts";

/**
 * Trang nào đang thật sự nhận được đoạn diễn giải, và trang nào không.
 *
 * Vì sao cần: cache đoạn per-ZIP khoá theo (vertical, zip, factsFingerprint),
 * nên THU THẬP THÊM DỮ LIỆU làm fingerprint đổi và mọi đoạn viết trước đó
 * lập tức bị coi như không tồn tại. Quy tắc ấy đúng — một đoạn mô tả số liệu
 * đã cũ thì không nên phục vụ. Cái sai là nó xảy ra IM LẶNG:
 *
 *   - trang vẫn trả 200, vì mọi câu có số liệu đến từ bảng chứ không từ đoạn
 *   - trang vẫn dựng đủ, chỉ ngắn đi
 *   - không log nào nối "hôm nay thu thập dữ liệu" với "hôm nay mất 126 đoạn"
 *
 * Đo ngày 15/9/2026 trên atmovingservices: 126 trong 161 ZIP giữ đoạn sinh
 * ngày 7/9, và KHÔNG đoạn nào trong số đó còn khớp fingerprint hiện tại.
 * Tiền đã tiêu, chữ đã mất, không ai biết.
 *
 * ĐIỂM THIẾT KẾ QUAN TRỌNG NHẤT: hàm này hỏi ĐÚNG những hàm mà endpoint hỏi
 * — getCachedInterpretation và getCachedClusterText. Không tự cài lại phép so
 * fingerprint. Cài lại là dựng định nghĩa thứ hai về "đoạn này còn dùng được
 * không", và định nghĩa thứ hai sẽ trôi lệch khỏi cái thật đúng vào lúc
 * không ai nhìn. Cái giá phải trả là chậm (mỗi ZIP một lần dựng fact set),
 * và đó là cái giá đúng cho một phép kiểm chạy theo lịch.
 */

export type PageKind = "market" | "cluster";

export interface InventoryEntry {
  zip: string;
  path: string;
  kind: PageKind;
}

/** Một TRANG, sau khi gộp các ZIP cùng trỏ về một đường dẫn. */
export interface InventoryPage {
  path: string;
  kind: PageKind;
  zips: string[];
}

/**
 * Gộp entry theo đường dẫn. Thuần, và tách ra để kiểm được.
 *
 * Inventory liệt kê theo ZIP chứ không theo trang: 256 ZIP ứng với 158 trang,
 * vì nhiều ZIP trong một cụm cùng trỏ về một đường dẫn. Đếm entry rồi gọi đó
 * là số trang là sai gấp rưỡi — và sai theo hướng khiến độ phủ trông tệ hơn
 * thực tế, tức là hướng người ta sẽ tin.
 */
export function groupByPage(entries: InventoryEntry[]): InventoryPage[] {
  const byPath = new Map<string, InventoryPage>();
  for (const e of entries) {
    const found = byPath.get(e.path);
    if (found) {
      if (!found.zips.includes(e.zip)) found.zips.push(e.zip);
    } else {
      byPath.set(e.path, { path: e.path, kind: e.kind, zips: [e.zip] });
    }
  }
  // Sắp ZIP để tập thành viên ổn định — clusterIdOf băm tập ĐÃ SẮP XẾP, và
  // một thứ tự khác nhau giữa hai lần chạy sẽ ra hai cụm khác nhau.
  for (const p of byPath.values()) p.zips.sort();
  return [...byPath.values()];
}

export type CoverageState =
  /** Site sẽ nhận được chữ. */
  | "fresh"
  /** Đã từng sinh đoạn cho trang này, nhưng không bản nào còn dùng được —
   *  tiền đã tiêu, chữ không tới nơi. Khác hẳn "chưa làm". */
  | "stale"
  /** Chưa từng sinh đoạn nào. */
  | "never";

export interface PageCoverage extends InventoryPage {
  state: CoverageState;
}

export interface CoverageReport {
  pages: PageCoverage[];
  fresh: number;
  stale: number;
  never: number;
}

export function summarize(pages: PageCoverage[]): CoverageReport {
  return {
    pages,
    fresh: pages.filter((p) => p.state === "fresh").length,
    stale: pages.filter((p) => p.state === "stale").length,
    never: pages.filter((p) => p.state === "never").length,
  };
}

/** Đã từng có đoạn ĐẠT cho ZIP này chưa, bất kể fingerprint. Đây là thứ
 * phân biệt "đã trả tiền rồi mất" với "chưa làm bao giờ". */
async function everGeneratedMarket(vertical: string, zip: string): Promise<boolean> {
  const n = await prisma.aiGeneration.count({ where: { vertical, zip, validationPassed: true } });
  return n > 0;
}

async function everGeneratedCluster(vertical: string, zips: string[]): Promise<boolean> {
  // clusterIdOf, KHÔNG phải `memberZips hasEvery`. hasEvery cũng khớp những
  // cụm CHỨA tập này cộng thêm ZIP khác — tức là một cụm khác, mô tả một dải
  // khác. Dùng đúng định danh mà production dùng thì không có khoảng lệch nào
  // để trôi vào.
  const n = await prisma.aiClusterGeneration.count({
    where: { vertical, validationPassed: true, clusterId: clusterIdOf(vertical, zips) },
  });
  return n > 0;
}

export async function auditPage(vertical: string, page: InventoryPage): Promise<PageCoverage> {
  if (page.kind === "market") {
    const zip = page.zips[0];
    const cached = await getCachedInterpretation(vertical, zip);
    if (cached) return { ...page, state: "fresh" };
    return { ...page, state: (await everGeneratedMarket(vertical, zip)) ? "stale" : "never" };
  }

  const text = await getCachedClusterText(vertical, page.zips);
  if (text) return { ...page, state: "fresh" };
  return { ...page, state: (await everGeneratedCluster(vertical, page.zips)) ? "stale" : "never" };
}

/**
 * Quyết định của cổng, tách khỏi phần chạy để kiểm được mà không phải soi
 * 158 trang qua tunnel (12 phút mỗi lần).
 *
 * Tách ra vì lần chạy đầu tiên đã che mất chính nó: script chạy qua `| grep`,
 * nên `$?` là mã của grep chứ không phải của script, và "exit=0" hiện ra
 * trong khi cổng lẽ ra đang đỏ. Một cổng mà mã thoát của nó chưa ai nhìn
 * thấy thì chưa phải cổng.
 *
 * `never` KHÔNG làm đỏ: chưa sinh đoạn cho một trang là việc còn phải làm,
 * không phải hồi quy. Gộp hai thứ vào một cảnh báo là cách biến cảnh báo
 * thành thứ người ta tắt.
 */
export function exitCodeFor(report: Pick<CoverageReport, "stale" | "never" | "fresh">): 0 | 1 {
  return report.stale > 0 ? 1 : 0;
}
