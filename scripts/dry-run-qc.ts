// Ráp MỌI ứng viên bằng một đoạn AI giữ chỗ rồi chấm QC thật.
//
// Vì sao cần: mọi phép kiểm trên TRANG ĐÃ RÁP, và phần lớn trang đến từ
// template chứ không từ model. Một lỗi cấu trúc — tiêu đề quá dài, tiêu đề
// trùng, template thiếu khối — sẽ làm trượt mọi lần thử, và model không sửa
// được vì nó không viết những thứ đó. Phát hiện bằng cách bấm "Viết bài này"
// là phát hiện sau ba lần gọi API đã tính tiền.
//
// Chạy khô KHÔNG thay thế lần chạy thật: nó không kiểm được đoạn model viết.
// Nó chỉ loại bỏ nhóm lỗi mà model không có vai trò gì.
//
// Dùng: tsx scripts/dry-run-qc.ts [số lượng]

import { discoverCandidates, buildCandidate } from "../lib/article-candidates/discover";
import { buildQcContext } from "../lib/article-qc/write-loop";
import { runQc } from "../lib/article-qc/checklist";
import { renderArticle, assertTemplate, templateProse, placeholders } from "../lib/article-template/render";
import { DEFAULT_TEMPLATES } from "../lib/article-template/defaults";
import { fetchServedInventory } from "../lib/publisher/inventory";
import { prisma } from "../lib/db/prisma";

const PLACEHOLDER =
  "Records for the area show how many households arrive and leave each year, what homes are worth and what households earn. " +
  "Read them alongside each other rather than one at a time. " +
  "When you ask for quotes, say which kind of move you have and confirm what the estimate covers. " +
  "Ask each company to put the figure in writing before you book.";

async function main() {
  const website = await prisma.website.findFirst({ where: { vertical: "moving-services" } });
  if (!website) { console.error("Không có website moving-services."); process.exitCode = 1; return; }

  const inv = await fetchServedInventory(website.url);
  const all = await discoverCandidates(website.vertical, { servedZips: new Set(inv.byZip.keys()) });

  const limit = Number(process.argv[2] ?? all.length);
  const candidates = all.slice(0, limit);
  console.log(`Chạy khô ${candidates.length}/${all.length} ứng viên.\n`);

  // Template phải hợp lệ TRƯỚC, một lần — template hỏng làm trượt mọi bài và
  // báo cáo theo từng bài sẽ giấu mất nguyên nhân chung.
  for (const [intent, t] of Object.entries(DEFAULT_TEMPLATES)) {
    const err = assertTemplate(t);
    console.log(`${err ? "✗" : "✓"} template "${intent}"${err ? ` — ${err}` : ""}`);
  }
  const missing = [...new Set(candidates.map((c) => c.intent).filter(Boolean))].filter(
    (i) => !DEFAULT_TEMPLATES[i as string]
  );
  if (missing.length > 0) {
    console.error(`\n✗ KHÔNG có template cho ý định: ${missing.join(", ")} — mọi bài thuộc nhóm này sẽ hỏng ngay.`);
    process.exitCode = 1;
  }

  const ctx = await buildQcContext(website.id, website.vertical, website.url);
  const sources = await prisma.dataSource.findMany({
    where: { isActive: true, relevantVerticals: { has: website.vertical } },
    select: { name: true },
    orderBy: { name: "asc" },
  });

  const failures = new Map<string, number>();
  const seenTitles = new Set<string>(ctx.existingTitles);
  let passed = 0;
  let unbuildable = 0;

  for (const c of candidates) {
    if (!c.intent) { unbuildable++; continue; }
    const full = await buildCandidate(website.vertical, c.zip, c.intent);
    if (!full) { unbuildable++; continue; }

    const draft = renderArticle({
      template: DEFAULT_TEMPLATES[c.intent],
      candidate: full,
      aiParagraph: PLACEHOLDER,
      knownPaths: ctx.knownPaths,
      sourceNames: sources.map((s) => s.name),
    });

    // Tiêu đề trùng tích luỹ TRONG lô, không chỉ so với bài đã có: viết 48
    // bài cùng tên trong một lô thì bài thứ hai trở đi đều trượt, và chạy khô
    // phải thấy điều đó y như lúc chạy thật.
    const report = runQc(draft, {
      ...ctx,
      factSet: { ...full, mainKeyword: null, countyKeyword: null, searchIntent: c.intent },
      existingTitles: [...seenTitles],
      differentiation: { aiParagraph: PLACEHOLDER, templateProse: templateProse(DEFAULT_TEMPLATES[c.intent], placeholders(full)) },
    });
    seenTitles.add(draft.title);

    const failed = report.checks.filter((x) => !x.passed);
    if (failed.length === 0) passed++;
    for (const f of failed) failures.set(f.id, (failures.get(f.id) ?? 0) + 1);
  }

  console.log(`\nđạt hết checklist: ${passed}/${candidates.length}`);
  if (unbuildable > 0) console.log(`không dựng được fact set: ${unbuildable}`);
  if (failures.size > 0) {
    console.log("\nmục trượt (số bài):");
    for (const [id, n] of [...failures].sort((a, b) => b[1] - a[1])) console.log(`  ${id}: ${n}`);
  }
  await prisma.$disconnect();
}

main();
