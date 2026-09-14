import { prisma } from "@/lib/db/prisma";

/**
 * Ngân sách AI theo publisher.
 *
 * Vì sao nó MỀM: nội dung của publisher phụ thuộc hoàn toàn vào AI. Một
 * trần chặn cứng ở đây không tiết kiệm được gì — nó chỉ dừng sản phẩm giữa
 * chừng, và người ta sẽ nâng trần ngay lập tức để chạy tiếp. Cái thực sự
 * cần biết là "tôi đang ở đâu so với dự tính", và câu đó trả lời bằng màu
 * sắc chứ không bằng một exception. Chặn cứng chống chạy loạn vẫn còn ở
 * AppConfig key "ai" và là con số khác hẳn — xem ghi chú cuối file.
 *
 * ⚠️ Vì sao quy chiếu theo VERTICAL chứ không theo websiteId:
 *
 * Đo 14/9/2026: 401/401 dòng AiSpend có websiteId = NULL. Không phải lỗi —
 * đoạn diễn giải của một ZIP được cache theo niche và phục vụ mọi publisher
 * trong niche đó, nên nó không thuộc về site nào. Một ngân sách cộng theo
 * websiteId sẽ hiện $0,00 mãi mãi và KHÔNG BAO GIỜ highlight, tức là đúng
 * loại tín hiệu không thể kêu mà cả hệ này đang tránh.
 *
 * Nên số so với ngân sách là chi tiêu của NICHE. Khi một niche có nhiều hơn
 * một publisher, con số đó là chung — `sharedWithSites` nói rõ, để không ai
 * đọc nó như chi tiêu riêng của site mình.
 */

export type BudgetVerdict = "no-budget" | "under" | "over";

export interface BudgetStatus {
  budgetUsd: number | null;
  /** Dòng sổ gắn đích danh websiteId này. */
  ownUsd: number;
  /** Dòng sổ của cùng niche nhưng không gắn site nào — cache dùng chung. */
  sharedUsd: number;
  totalUsd: number;
  /** Số publisher cùng niche. >1 nghĩa là sharedUsd được chia sẻ, không của riêng ai. */
  sharedWithSites: number;
  verdict: BudgetVerdict;
  /** Null khi chưa đặt ngân sách — KHÔNG phải 0. */
  percent: number | null;
  overUsd: number;
}

/**
 * Phần quyết định, thuần, tách khỏi truy vấn để kiểm được.
 *
 * Ba trạng thái chứ không phải hai. "Chưa đặt ngân sách" không được gộp
 * vào "trong ngân sách": một ô xanh cho một ngân sách không tồn tại trả
 * lời sai đúng câu người ta đang hỏi.
 */
export function judgeBudget(params: {
  budgetUsd: number | null;
  ownUsd: number;
  sharedUsd: number;
  sharedWithSites: number;
}): BudgetStatus {
  const { budgetUsd, ownUsd, sharedUsd, sharedWithSites } = params;
  const totalUsd = ownUsd + sharedUsd;

  // Ngân sách 0 là một lựa chọn có nghĩa ("niche này không được tiêu gì
  // nữa"), khác hẳn null. Dùng `budgetUsd ?? null` chứ không `|| null`:
  // `0 || null` cho null và sẽ nuốt mất lựa chọn đó.
  const hasBudget = budgetUsd !== null && budgetUsd !== undefined;

  if (!hasBudget) {
    return { budgetUsd: null, ownUsd, sharedUsd, totalUsd, sharedWithSites, verdict: "no-budget", percent: null, overUsd: 0 };
  }

  // Ngân sách 0: mọi khoản chi đều là vượt. Chia cho 0 ra Infinity nên
  // percent tính riêng, không để NaN/Infinity lọt xuống giao diện.
  const percent = budgetUsd === 0 ? (totalUsd > 0 ? 100 : 0) : (totalUsd / budgetUsd) * 100;
  const over = totalUsd > budgetUsd;

  return {
    budgetUsd,
    ownUsd,
    sharedUsd,
    totalUsd,
    sharedWithSites,
    verdict: over ? "over" : "under",
    percent,
    overUsd: over ? totalUsd - budgetUsd : 0,
  };
}

export async function getBudgetStatus(websiteId: string): Promise<BudgetStatus | null> {
  const site = await prisma.website.findUnique({
    where: { id: websiteId },
    select: { vertical: true, aiBudgetUsd: true },
  });
  if (!site) return null;

  const [own, shared, sharedWithSites] = await Promise.all([
    prisma.aiSpend.aggregate({ _sum: { costUsd: true }, where: { websiteId } }),
    // Cùng niche, chưa gắn site nào. Không lấy dòng của site KHÁC trong
    // cùng niche: tiền đó có chủ rồi.
    prisma.aiSpend.aggregate({ _sum: { costUsd: true }, where: { vertical: site.vertical, websiteId: null } }),
    prisma.website.count({ where: { vertical: site.vertical } }),
  ]);

  return judgeBudget({
    budgetUsd: site.aiBudgetUsd,
    ownUsd: own._sum.costUsd ?? 0,
    sharedUsd: shared._sum.costUsd ?? 0,
    sharedWithSites,
  });
}

/**
 * Chi tiêu không thuộc publisher nào — niche chưa có site nào kết nối.
 *
 * Có mặt ở đây để nó không biến mất: tổng của mọi ngân sách publisher sẽ
 * nhỏ hơn sổ chi thật, và phần chênh đó phải nhìn thấy được ở đâu đó thay
 * vì làm người đọc nghĩ mình đã cộng nhầm. Đo 14/9: $0,1261 trên hai niche
 * chưa có publisher.
 */
export async function getUnattributedSpendUsd(): Promise<number> {
  const sites = await prisma.website.findMany({ select: { vertical: true } });
  const verticals = [...new Set(sites.map((s) => s.vertical))];
  const agg = await prisma.aiSpend.aggregate({
    _sum: { costUsd: true },
    where: { vertical: { notIn: verticals }, websiteId: null },
  });
  return agg._sum.costUsd ?? 0;
}

/**
 * Tỷ lệ đã tiêu, dạng chữ.
 *
 * `toFixed(0)` biến mọi khoản dưới 1% thành "0%" — đọc ra là chưa tiêu gì,
 * trong khi $0,065 đã ra khỏi ví. Khoảng cách giữa "chưa tiêu" và "tiêu ít"
 * nhỏ về tiền nhưng khác hẳn về nghĩa: một cái nói đường ống chưa chạy.
 */
export function formatBudgetPercent(percent: number | null): string | null {
  if (percent === null) return null;
  if (percent === 0) return "0%";
  if (percent < 1) return "<1%";
  return `${percent.toFixed(0)}%`;
}
