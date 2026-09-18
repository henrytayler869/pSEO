import { prisma } from "@/lib/db/prisma";
import { fetchServedInventory } from "@/lib/publisher/inventory";
import { getCachedClusterText } from "@/lib/ai/cluster-generate";

/**
 * Hàng đợi điền đoạn cho các trang CỤM của một publisher.
 *
 * Trang cụm gộp nhiều ZIP vào một trang, nên nó KHÔNG đọc đoạn per-ZIP —
 * cluster-view.tsx bên publisher không tham chiếu tới lớp AI theo ZIP. Đó là
 * lý do hàng đợi theo ZIP phải loại chúng ra (pSEO #121), và là lý do phải có
 * hàng đợi thứ hai này: nếu không, phần việc còn lại của một site chỉ toàn
 * cụm sẽ hiện ra dưới dạng "không còn gì để điền".
 *
 * Đo 19/9/2026: atmovingservices.com có 58/58 trang lẻ đã đủ chữ và 111 ZIP
 * nằm trong cụm. Màn hình nói "xong", và 31 trang cụm — giữ những từ khoá lớn
 * nhất của site — vẫn 100% template.
 *
 * Phần quyết định nằm ở đây chứ không nằm trong scripts/generate-cluster-text.ts
 * để nút bấm và script chạy tay không thể trả lời khác nhau về việc cụm nào
 * còn thiếu.
 */

export interface ClusterCandidate {
  /** Đường dẫn trang cụm bên publisher. Danh tính hiển thị, không phải khoá. */
  path: string;
  /** Tập ZIP thành viên — ĐÂY mới là khoá, xem AiClusterGeneration.clusterId. */
  zips: string[];
  keyword: string | null;
  searchVolume: number | null;
  served: boolean;
}

export interface ClusterFillSummary {
  total: number;
  served: number;
  /** Chi phí ước tính cho phần chưa có chữ, USD. */
  estimatedUsd: number;
}

export interface ClusterFillQueue {
  vertical: string;
  summary: ClusterFillSummary;
  /** Chưa có chữ, xếp theo lượng tìm giảm dần. */
  pending: ClusterCandidate[];
  /** Không dựng được hàng đợi, và lý do. `pending` rỗng khi có giá trị. */
  unavailable?: string;
}

/**
 * Giá một đoạn CỤM, đo trên 55 cụm đã trả tiền thật cho moving-services,
 * tính 19/9/2026: trung bình $0,0446, p90 $0,0619, cao nhất $0,1307.
 *
 * Gấp khoảng 2,6 lần đoạn theo ZIP ($0,0237), và con số đó phải đo chứ không
 * suy: một cụm cần trung bình 1,8 lần thử vì luật "đừng nói một đầu dải như
 * thể nó tả cả vùng" khó hơn hẳn, và mỗi lần thử là một lần trả tiền.
 *
 * p90 chứ không phải trung bình, cùng lý do với đoạn theo ZIP: ước thấp là
 * cách người bấm biết mình vượt ngân sách SAU khi đã tiêu.
 */
export const COST_PER_CLUSTER_USD = 0.0619;

export async function buildClusterFillQueue(site: { vertical: string; url: string }): Promise<ClusterFillQueue> {
  const { vertical } = site;
  const empty = { total: 0, served: 0, estimatedUsd: 0 };

  let inventory;
  try {
    inventory = await fetchServedInventory(site.url);
  } catch (err) {
    return {
      vertical,
      summary: empty,
      pending: [],
      unavailable:
        `Không đọc được /api/inventory của ${site.url}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Thành viên cụm do publisher quyết định, nên không đọc được thì không có gì để sinh.`,
    };
  }

  // Gom ZIP theo đường dẫn trang cụm. Publisher quyết định cụm gồm những ai;
  // HQ chỉ đọc, không tính lại — quy tắc gộp keyed trên TỪ KHOÁ chung, và
  // không phép ghép nào bên này dựng lại được nó.
  const byPath = new Map<string, string[]>();
  for (const [zip, path] of inventory.byZip) {
    if (inventory.kindByZip.get(zip) !== "cluster") continue;
    byPath.set(path, [...(byPath.get(path) ?? []), zip]);
  }

  // Volume của cụm = volume từ khoá của thành viên cao nhất. Mọi thành viên
  // chung một từ khoá nên con số này là của cả cụm.
  const ids = await prisma.marketIdentity.findMany({
    where: { vertical },
    select: { zip: true, keywordMetrics: { select: { keyword: true, searchVolume: true } } },
  });
  const volByZip = new Map<string, { keyword: string; volume: number }>();
  for (const i of ids) {
    const lead = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    if (lead) volByZip.set(i.zip, { keyword: lead.keyword, volume: lead.searchVolume });
  }

  const candidates: ClusterCandidate[] = [];
  for (const [path, zips] of byPath) {
    const best = zips
      .map((z) => volByZip.get(z))
      .filter((v): v is { keyword: string; volume: number } => Boolean(v))
      .sort((a, b) => b.volume - a.volume)[0];
    // Hỏi ĐÚNG hàm mà endpoint đọc cụm hỏi. Câu yếu hơn — "có hàng nào trong
    // bảng cho cụm này không" — bỏ qua fingerprint, nên một cụm đã đổi thành
    // viên sẽ báo "đã có" trong khi site nhận 404.
    const served = (await getCachedClusterText(vertical, zips)) !== null;
    candidates.push({
      path,
      zips,
      keyword: best?.keyword ?? null,
      searchVolume: best?.volume ?? null,
      served,
    });
  }

  const pending = candidates
    .filter((c) => !c.served)
    .sort((a, b) => (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.path.localeCompare(b.path));

  return {
    vertical,
    summary: {
      total: candidates.length,
      served: candidates.filter((c) => c.served).length,
      estimatedUsd: Number((pending.length * COST_PER_CLUSTER_USD).toFixed(4)),
    },
    pending,
  };
}
