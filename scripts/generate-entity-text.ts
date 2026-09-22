/**
 * Sinh (hoặc đọc lại) đoạn diễn giải cho MỘT trang trên trục thực thể.
 *
 *     npm run entity:generate -- team en-1/arsenal-fc --dry     # chỉ in prompt, KHÔNG gọi model
 *     npm run entity:generate -- team en-1/arsenal-fc           # sinh thật
 *     npm run entity:generate -- fixture en-1/arsenal-fc__chelsea-fc
 *
 * `--dry` có trước và có lý do: ở trục địa lý, cách duy nhất để xem prompt
 * từng là yêu cầu sinh nó, và yêu cầu thì tiêu tiền. Một session thăm dò một
 * thị trường để chạy thử một nhánh đã trả tiền thật cho một đoạn văn không ai
 * muốn.
 */
import {
  buildEntityFactSet, entitySystemPrompt, getCachedEntityInterpretation,
  getOrGenerateEntityInterpretation, renderEntityFactsForPrompt,
} from "@/lib/ai/entity-generate";
import { FOOTBALL_VERTICAL } from "@/lib/page-axis/axes";
import { prisma } from "@/lib/db/prisma";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--dry");
  const dry = process.argv.includes("--dry");
  const [axis, key] = args;
  if (!axis || !key) {
    console.error("Dùng: npm run entity:generate -- <axis> <key> [--dry]");
    console.error("Ví dụ: npm run entity:generate -- team en-1/arsenal-fc --dry");
    process.exit(1);
  }

  const fs = await buildEntityFactSet(FOOTBALL_VERTICAL, axis, key);
  if (!fs) {
    console.error(`Không dựng được fact cho ${axis} "${key}". Khoá sai, hoặc đội không có trong mùa đang đá.`);
    process.exit(1);
  }

  console.log(`\n=== ${fs.displayName} · ${fs.leagueName} · mùa ${fs.season} ===`);
  console.log(`${fs.facts.length} chỉ số, vân tay ${fs.fingerprint}, trễ ${fs.stalenessDays ?? "?"} ngày\n`);

  if (dry) {
    console.log("--- SYSTEM ---");
    console.log(entitySystemPrompt(FOOTBALL_VERTICAL));
    console.log("\n--- PROMPT ---");
    console.log(renderEntityFactsForPrompt(fs));
    console.log("\n--dry: KHÔNG gọi model, không tốn gì.");
    return;
  }

  const existing = await getCachedEntityInterpretation(FOOTBALL_VERTICAL, axis, key);
  if (existing) {
    console.log("ĐÃ CÓ trong cache (vân tay khớp, và văn vẫn qua được luật hôm nay):\n");
    console.log(existing.text);
    return;
  }

  const out = await getOrGenerateEntityInterpretation(FOOTBALL_VERTICAL, axis, key);
  if (!out) {
    console.error("Không sinh được — không có hàng danh tính, hoặc tập fact rỗng.");
    process.exit(1);
  }

  console.log(out.text);
  console.log(`\n${out.attempts} lượt thử, $${out.costUsd.toFixed(4)}`);
  if (out.validation.passed) {
    console.log("ĐẠT validator.");
  } else {
    console.log("TRƯỢT validator — bản trên KHÔNG được phục vụ:");
    for (const i of out.validation.issues) console.log(`  ${i.rule}: ${i.detail}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
