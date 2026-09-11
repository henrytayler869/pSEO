// Khẳng định: mọi ứng viên được LIỆT KÊ đều VIẾT ĐƯỢC.
//
// Điều kiện lọc nằm ở discoverCandidates, điều kiện dựng nằm ở buildFactSet —
// hai file khác nhau. Khi chúng lệch, triệu chứng là người dùng bấm "Viết bài
// này" rồi nhận lỗi, tức là lỗi hiện ra ở chỗ xa nơi sinh ra nó. Đo 11/9/2026,
// chúng ĐÃ lệch: danh sách mời 218 nơi, nơi đầu tiên (ZIP 00725) dựng không
// được.
//
// Đây là MẪU, không phải chứng minh: dựng fact set mất 2.6–5.3 giây một ZIP,
// nên kiểm cả 174 nơi sẽ mất mười phút. Lấy đầu, giữa, cuối — lệch điều kiện
// thường theo cả một lớp dữ liệu chứ không theo một ZIP lẻ.
//
// Dùng: tsx scripts/test-candidates.ts

import { discoverCandidates, buildCandidate } from "../lib/article-candidates/discover";
import { prisma } from "../lib/db/prisma";

const VERTICAL = "moving-services";

async function main() {
  const all = await discoverCandidates(VERTICAL);
  console.log(`${all.length} ứng viên được liệt kê.`);
  if (all.length === 0) {
    console.error("THẤT BẠI: không ứng viên nào — không có gì để kiểm.");
    process.exitCode = 1;
    return;
  }

  const sample = [all[0], all[Math.floor(all.length / 2)], all[all.length - 1]];
  let ok = 0;
  const failures: string[] = [];

  for (const c of sample) {
    const full = await buildCandidate(VERTICAL, c.zip, c.intent ?? "commercial");
    if (!full) {
      failures.push(`${c.zip} ${c.city}, ${c.state} được liệt kê nhưng buildCandidate trả null`);
      console.log(`✗ ${c.zip} ${c.city}`);
      continue;
    }
    if (full.facts.length === 0) {
      failures.push(`${c.zip} dựng được nhưng 0 fact — bài sẽ không có con số nào`);
      console.log(`✗ ${c.zip} ${c.city} (0 fact)`);
      continue;
    }
    ok++;
    console.log(`✓ ${c.zip} ${c.city}, ${c.state} — ${full.facts.length} fact`);
  }

  // Số chỉ số hứa trong danh sách phải khớp số fact dựng ra được. Lệch thì
  // danh sách đang quảng cáo dữ liệu mà bài không có.
  const first = sample[0];
  const full = await buildCandidate(VERTICAL, first.zip, first.intent ?? "commercial");
  if (full && full.facts.length !== first.metricCount) {
    failures.push(
      `${first.zip}: danh sách nói ${first.metricCount} chỉ số, dựng ra ${full.facts.length} fact`
    );
    console.log(`✗ số chỉ số hứa (${first.metricCount}) khác số fact thật (${full.facts.length})`);
  } else if (full) {
    ok++;
    console.log(`✓ số chỉ số hứa khớp số fact thật (${first.metricCount})`);
  }

  console.log(`\n${ok}/${sample.length + 1} kiểm tra đúng.`);
  if (failures.length > 0) {
    console.error(`\nTHẤT BẠI:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main();
