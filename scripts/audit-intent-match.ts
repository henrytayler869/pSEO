// Đo xem nội dung đã sinh có khớp ý định tìm kiếm của thị trường hay không.
//
// Dùng: tsx scripts/audit-intent-match.ts
//
// Dấu hiệu bắt theo CẤU TRÚC câu, không theo từ. Phiên bản đầu bắt cả chữ
// "quote" và báo 5/27 đoạn còn lệch; đọc cả 5 thì không đoạn nào lệch —
// chúng dùng "quote" theo nghĩa hỏi giá ở hãng ĐÃ chọn. Một dấu hiệu bắt
// theo từ sẽ đếm lẫn hai ý nghĩa trái nhau, và con số sai đó trông hợp lý đủ
// để tin.

import { prisma } from "../lib/db/prisma";

/** Giục người đọc đi so sánh giữa NHIỀU hãng. Sai với transactional và
 * navigational — hai nhóm đó đã chọn xong. */
const SHOPPING =
  /\b(compare|comparing|shop around|(estimates?|quotes?) from (two|three|at least|several|multiple)|two or three (movers|companies|firms))\b/i;

/** Nói về MỘT hãng đã chọn. Đúng với transactional và navigational. */
const SINGLE_FIRM = /\b(the company you have in mind|whichever firm|already have a specific company|when you call|the crew)\b/i;

/** Nhóm nào ĐƯỢC phép giục so sánh. */
const MAY_SHOP = new Set(["commercial", "(chưa đo)"]);

async function main() {
  const vertical = process.argv[2] ?? "moving-services";
  const gens = await prisma.aiGeneration.findMany({ where: { vertical }, select: { zip: true, text: true, createdAt: true } });
  const ids = await prisma.marketIdentity.findMany({
    where: { vertical },
    select: { zip: true, keywordMetrics: { select: { searchVolume: true, mainIntent: true } } },
  });
  const intentByZip = new Map<string, string>();
  for (const i of ids) {
    const lead = [...i.keywordMetrics].sort((a, b) => b.searchVolume - a.searchVolume)[0];
    intentByZip.set(i.zip, lead?.mainIntent ?? "(chưa đo)");
  }

  // Chỉ bản MỚI NHẤT mỗi ZIP: bản cũ vẫn nằm trong bảng, và đếm cả chúng sẽ
  // trộn nội dung trước và sau khi sinh lại thành một con số vô nghĩa.
  const newest = new Map<string, { text: string; at: Date }>();
  for (const g of gens) {
    if (!g.zip) continue;
    const cur = newest.get(g.zip);
    if (!cur || g.createdAt > cur.at) newest.set(g.zip, { text: g.text, at: g.createdAt });
  }

  const rows = new Map<string, { n: number; shopping: number; singleFirm: number }>();
  for (const [zip, { text }] of newest) {
    const intent = intentByZip.get(zip) ?? "(chưa đo)";
    const e = rows.get(intent) ?? { n: 0, shopping: 0, singleFirm: 0 };
    e.n++;
    if (SHOPPING.test(text)) e.shopping++;
    if (SINGLE_FIRM.test(text)) e.singleFirm++;
    rows.set(intent, e);
  }

  console.log(`${newest.size} đoạn (bản mới nhất mỗi ZIP), ngành "${vertical}"\n`);
  console.log("nhóm".padEnd(16) + "n".padStart(4) + "giục so sánh".padStart(16) + "một hãng".padStart(12) + "  đánh giá");
  let bad = 0;
  for (const [intent, e] of [...rows].sort((a, b) => b[1].n - a[1].n)) {
    const allowed = MAY_SHOP.has(intent);
    const wrong = allowed ? 0 : e.shopping;
    bad += wrong;
    const verdict = allowed ? "được phép giục so sánh" : wrong === 0 ? "khớp" : `LỆCH ${wrong} đoạn`;
    console.log(
      intent.padEnd(16) +
        String(e.n).padStart(4) +
        `${e.shopping} (${((e.shopping / e.n) * 100).toFixed(0)}%)`.padStart(16) +
        `${e.singleFirm}`.padStart(12) +
        `  ${verdict}`
    );
  }
  console.log(`\n${bad} đoạn giục so sánh trong nhóm KHÔNG được phép.`);
  if (bad > 0) process.exitCode = 1;
  await prisma.$disconnect();
}
main();
