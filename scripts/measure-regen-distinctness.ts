// Đo mạch trùng ĐẠT ĐƯỢC khi sinh lại kèm khối "đừng dùng lại cách diễn đạt".
//
// Tồn tại để MAX_SHARED_RUN_WORDS là con số đo được, không phải con số chọn
// cho đẹp. Ngưỡng quá chặt biến phép kiểm thành cánh cửa không ai qua nổi,
// và cái giá là người ta tắt nó đi — lúc đó không còn phép kiểm nào.
//
// KHÔNG ghi vào aiGeneration: đây là phép đo, không phải lần sinh phục vụ
// ai. Sổ chi vẫn ghi, vì tiền đã tiêu thật.
//
// Dùng: tsx scripts/measure-regen-distinctness.ts [số ZIP]

import { prisma } from "../lib/db/prisma";
import { buildFactSet } from "../lib/ai/facts";
import { generateWithClaude } from "../lib/ai/anthropic";
import { validateGeneratedText } from "../lib/ai/validate";
import { renderFactsForPrompt, systemPromptFor } from "../lib/ai/generate";
import { judgeDistinctness, avoidBlock } from "../lib/ai/distinctness";
import { numberArg, reportArgError } from "../lib/scripts/argv";

async function main() {
  const n = numberArg(0, 5);
  const rows = await prisma.aiGeneration.findMany({
    where: { validationPassed: true },
    orderBy: { createdAt: "desc" },
    select: { vertical: true, zip: true },
    distinct: ["vertical", "zip"],
    take: n,
  });
  if (rows.length === 0) { console.log("không có đoạn nào để đối chiếu."); return; }

  console.log(`đo ${rows.length} ZIP — mỗi ZIP một lần sinh, không ghi cache\n`);
  const results: number[] = [];
  let cost = 0;

  for (const r of rows) {
    const fs = await buildFactSet(r.vertical, r.zip);
    if (!fs) { console.log(`  ${r.zip} — không dựng được fact set`); continue; }
    const priors = await prisma.aiGeneration.findMany({
      where: { vertical: r.vertical, zip: r.zip, validationPassed: true },
      select: { text: true },
    });
    const priorTexts = priors.map((p) => p.text);

    const out = await generateWithClaude({
      system: systemPromptFor(r.vertical, fs.searchIntent),
      prompt: `${renderFactsForPrompt(fs)}${avoidBlock(priorTexts)}`,
      vertical: r.vertical,
      zip: r.zip,
    });
    cost += out.costUsd;

    // Ngưỡng Infinity: đang ĐO phân bố, không đang gác cổng.
    const v = judgeDistinctness(out.text, priorTexts, Number.POSITIVE_INFINITY);
    const facts = validateGeneratedText(out.text, fs);
    results.push(v.worstWords);
    console.log(
      `  ${r.zip}  trùng ${String(v.worstWords).padStart(3)} từ  (đối chiếu ${v.comparedWith} bản)  ` +
        `sự thật: ${facts.passed ? "đạt" : "TRƯỢT"}` +
        (v.worstPhrase ? `\n        "${v.worstPhrase.slice(0, 110)}${v.worstPhrase.length > 110 ? "…" : ""}"` : "")
    );
  }

  if (results.length > 0) {
    const sorted = [...results].sort((a, b) => a - b);
    console.log(
      `\nmạch trùng: nhỏ nhất ${sorted[0]} | giữa ${sorted[Math.floor(sorted.length / 2)]} | lớn nhất ${sorted[sorted.length - 1]}`
    );
    console.log(`chi phí đo: $${cost.toFixed(4)}`);
    console.log(`\nĐặt MAX_SHARED_RUN_WORDS trên mức lớn nhất một biên an toàn — dưới nó là cổng không ai qua.`);
  }
  await prisma.$disconnect();
}

main().catch((err) => { if (reportArgError(err)) return; throw err; });
