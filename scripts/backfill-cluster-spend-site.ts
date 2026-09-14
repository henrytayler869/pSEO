// Gắn websiteId cho những dòng sổ chi thuộc về đoạn cấp cụm đã sinh trước
// 14/9/2026, khi generateForCluster chưa truyền websiteId.
//
// KHÔNG phải đoán. AiSpend và AiClusterGeneration đều ghi inputTokens và
// outputTokens của cùng một lần gọi API, nên (vertical, inputTokens,
// outputTokens) là khoá tự nhiên nối hai bảng. Đo 14/9: 60/60 lần sinh
// ghép được ĐÚNG MỘT dòng sổ, 0 nhập nhằng, 0 sót; chi phí khớp tới phần
// nghìn đô và dấu thời gian lệch dưới 1 giây.
//
// Lý do tồn tại: cách còn lại là sinh lại 31 đoạn, tốn ~$1,45 và mua đúng
// một cột khoá ngoại — nội dung mới khác chữ nhưng không tốt hơn.
//
// Mặc định CHẠY KHÔ. Phải truyền --apply mới ghi.

import { prisma } from "../lib/db/prisma";
import { resolveSite, reportSiteError } from "../lib/scripts/resolve-site";

async function main() {
  const apply = process.argv.includes("--apply");

  const gens = await prisma.aiClusterGeneration.findMany({
    select: { id: true, vertical: true, label: true, inputTokens: true, outputTokens: true, costUsd: true },
  });
  if (gens.length === 0) { console.log("Không có lần sinh cụm nào."); return; }

  const verticals = [...new Set(gens.map((g) => g.vertical))];
  const siteOf = new Map<string, string>();
  for (const v of verticals) {
    // resolveSite từ chối khi một niche có nhiều site và không nêu --site.
    // Đó chính là chỗ phải từ chối: đoạn cụm thuộc về site nào là câu hỏi
    // có câu trả lời, và đoán sai ở đây gán tiền của site này cho site kia.
    const site = await resolveSite<{ id: string; url: string; vertical: string }>({ vertical: v });
    siteOf.set(v, site.id);
  }

  let matched = 0, ambiguous = 0, missing = 0, already = 0, totalUsd = 0;
  const updates: { spendId: string; websiteId: string; costUsd: number }[] = [];

  for (const g of gens) {
    const hits = await prisma.aiSpend.findMany({
      where: { vertical: g.vertical, inputTokens: g.inputTokens, outputTokens: g.outputTokens, zip: null },
      select: { id: true, websiteId: true, costUsd: true },
    });
    if (hits.length === 0) { missing++; continue; }
    if (hits.length > 1) {
      // Từ chối cả nhóm này thay vì chọn dòng đầu: hai dòng cùng số token
      // nghĩa là khoá không còn phân biệt được, và gán bừa một trong hai là
      // đúng thứ script này sinh ra để tránh.
      ambiguous++;
      console.log(`  ⚠ ${g.label} — ${hits.length} dòng sổ cùng (${g.inputTokens}/${g.outputTokens}) token, bỏ qua`);
      continue;
    }
    const hit = hits[0];
    if (hit.websiteId) { already++; continue; }
    matched++;
    totalUsd += hit.costUsd;
    updates.push({ spendId: hit.id, websiteId: siteOf.get(g.vertical)!, costUsd: hit.costUsd });
  }

  console.log(`\n${gens.length} lần sinh cụm`);
  console.log(`  ghép được, sẽ gắn: ${matched}  ($${totalUsd.toFixed(4)})`);
  console.log(`  đã có websiteId:   ${already}`);
  console.log(`  không tìm thấy sổ: ${missing}`);
  console.log(`  nhập nhằng:        ${ambiguous}`);

  if (!apply) {
    console.log(`\n--dry (mặc định): chưa ghi gì. Thêm --apply để ghi.`);
    await prisma.$disconnect();
    return;
  }

  // updateMany với điều kiện websiteId: null — nếu có tiến trình khác vừa
  // gắn xong thì lệnh này không ghi đè, và số đếm sẽ nói ra điều đó.
  let written = 0;
  for (const u of updates) {
    const r = await prisma.aiSpend.updateMany({
      where: { id: u.spendId, websiteId: null },
      data: { websiteId: u.websiteId },
    });
    written += r.count;
  }
  console.log(`\nđã gắn ${written}/${updates.length} dòng ($${totalUsd.toFixed(4)}).`);
  if (written !== updates.length) console.log(`  ${updates.length - written} dòng đã bị gắn bởi tiến trình khác — không ghi đè.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  if (reportSiteError(err)) return;
  throw err;
});
