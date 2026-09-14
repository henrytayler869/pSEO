// Soi toàn bộ văn bản AI đã lưu, tìm những bản RỖNG hoặc cụt.
//
// Viết sau sự cố 14/9/2026: model tiêu hết trần output vào khối thinking,
// trả về chuỗi rỗng, và mọi cổng kiểm ĐẠT trên chuỗi rỗng. Một đoạn rỗng
// được lưu là ĐẠT rồi phục vụ trên site.
//
// Không chỉ tìm chuỗi rỗng hẳn. Model chạm trần giữa chừng sẽ trả về một
// đoạn CỤT — có chữ, qua được validator vì không nêu số nào sai, mà vẫn là
// nửa câu. Đó là dạng khó thấy hơn, nên soi luôn.
//
// Phân biệt "đã lưu" với "ĐANG PHỤC VỤ": bản trượt nằm trong bảng là bằng
// chứng, không phải vấn đề. Chỉ bản mới nhất ĐẠT của mỗi (vertical, zip)
// mới thực sự lên trang.

import { prisma } from "../lib/db/prisma";

/** Dưới mức này thì không thể là đoạn 4-6 câu mà prompt đòi. Chọn rộng tay:
 * mục tiêu là lôi ra để người đọc nhìn, không phải tự động xoá. */
const SHORT_CHARS = 250;

function flags(text: string): string[] {
  const out: string[] = [];
  const t = text.trim();
  if (t.length === 0) return ["RỖNG"];
  if (t.length < SHORT_CHARS) out.push(`cụt (${t.length} ký tự)`);
  // Mọi đoạn đều phải nêu ít nhất một con số đo được — đó là toàn bộ lý do
  // nó tồn tại. Không có chữ số nào nghĩa là hoặc model lạc đề, hoặc nó bị
  // cắt trước khi tới phần số.
  if (!/\d/.test(t)) out.push("không có con số nào");
  // Câu cuối không kết thúc bằng dấu chấm câu: dấu hiệu bị cắt giữa chừng.
  if (!/[.!?]["')\]]?$/.test(t)) out.push("không kết thúc bằng dấu câu");
  return out;
}

async function main() {
  console.log("=== ĐOẠN THEO ZIP (AiGeneration) ===\n");
  const all = await prisma.aiGeneration.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, vertical: true, zip: true, text: true, validationPassed: true, outputTokens: true, createdAt: true },
  });

  // Bản ĐANG PHỤC VỤ: mới nhất và đạt, cho mỗi (vertical, zip).
  const served = new Map<string, (typeof all)[number]>();
  for (const r of all) {
    if (!r.validationPassed) continue;
    const k = `${r.vertical}|${r.zip}`;
    if (!served.has(k)) served.set(k, r);
  }

  let bad = 0;
  for (const [k, r] of served) {
    const f = flags(r.text);
    if (f.length === 0) continue;
    bad++;
    console.log(`  ⚠ ${k}  ${f.join(", ")}  [${r.outputTokens} token, ${r.createdAt.toISOString().slice(0, 10)}]`);
    if (r.text.trim().length > 0) console.log(`      …${r.text.trim().slice(-90)}`);
  }
  console.log(`\n${served.size} đoạn đang phục vụ — ${bad} có vấn đề.`);

  const storedBad = all.filter((r) => !r.validationPassed && flags(r.text).length > 0).length;
  console.log(`(${all.length} bản đã lưu; ${storedBad} bản TRƯỢT cũng có vấn đề — nằm trong bảng làm bằng chứng, không lên trang)`);

  console.log("\n=== ĐOẠN CẤP CỤM (AiClusterGeneration) ===\n");
  const clusters = await prisma.aiClusterGeneration.findMany({
    orderBy: { createdAt: "desc" },
    select: { clusterId: true, label: true, text: true, validationPassed: true, outputTokens: true },
  });
  const servedC = new Map<string, (typeof clusters)[number]>();
  for (const c of clusters) {
    if (!c.validationPassed) continue;
    if (!servedC.has(c.clusterId)) servedC.set(c.clusterId, c);
  }
  let badC = 0;
  for (const [, c] of servedC) {
    const f = flags(c.text);
    if (f.length === 0) continue;
    badC++;
    console.log(`  ⚠ ${c.label}  ${f.join(", ")}  [${c.outputTokens} token]`);
  }
  console.log(`\n${servedC.size} đoạn cụm đang phục vụ — ${badC} có vấn đề.`);

  if (bad + badC > 0) process.exitCode = 1;
  await prisma.$disconnect();
}
main();
