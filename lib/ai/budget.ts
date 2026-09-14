import { prisma } from "@/lib/db/prisma";
import { judgeBudget, type BudgetStatus } from "./budget-core";

// Chỉ phần CHẠM DATABASE nằm ở đây. Phần thuần ở budget-core.ts để client
// component import được mà không kéo Prisma vào trình duyệt — xem chú thích
// đầu file đó.
export * from "./budget-core";

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
 * vì làm người đọc nghĩ mình đã cộng nhầm. Đo 14/9: $0,2505 trên BỐN
 * niche chưa có publisher (hvac-repair, roofing-replacement,
 * solar-installation, water-damage-restoration).
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

