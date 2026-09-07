// Generates validated interpretation copy for every buildable market in a
// vertical, so a consuming site can fetch all of it from cache instead of
// paying for a cold generation on every page build.
//
// Safe to re-run: anything already generated and passing validation is
// skipped, so a run that stops halfway (spend cap, network, Ctrl-C) is
// resumed simply by running it again.
//
// The spend cap is the real stop condition. It is checked inside
// generateWithClaude() before every call, so this script does not need to
// predict cost — it just stops cleanly when the ceiling refuses the next
// call, having spent exactly what was authorised and no more.
//
// Usage:
//   tsx scripts/generate-interpretations.ts <vertical> [--standalone-only] [--limit N] [--concurrency N]
//
// --standalone-only restricts generation to markets that are the ONLY one
// targeting their search term in their state. That matters because this
// text is written about ONE zip, and a consuming site renders it on a page
// about one zip. Where several zips share a page (a cluster page), a
// paragraph describing a single member would be presented as though it
// described all of them — the same kind of false framing the validator
// exists to stop, just at the page level instead of the sentence level.
// Generating for cluster members is therefore not merely wasteful, it
// produces text with no honest place to appear.

import { prisma } from "../lib/db/prisma";
import { computeTrafficValues } from "../lib/keywords/traffic-metrics";
import { latestPerKeyword } from "../lib/keywords/latest";
import { getRealDataPointsForZipAndVertical, getCountyKeywordForZip } from "../lib/queries/collector";
import { getOrGenerateInterpretation } from "../lib/ai/generate";
import { getTotalSpendUsd, getAiConfig, SpendCapExceededError } from "../lib/ai/anthropic";

const DEFAULT_CONCURRENCY = 4; // modest on purpose — this is a bulk job against a rate-limited API

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const vertical = process.argv[2];
  if (!vertical) {
    console.error("Cách dùng: tsx scripts/generate-interpretations.ts <vertical> [--limit N] [--concurrency N]");
    process.exitCode = 1;
    return;
  }
  const limit = Number(argValue("--limit") ?? Number.POSITIVE_INFINITY);
  const standaloneOnly = process.argv.includes("--standalone-only");
  const concurrency = Number(argValue("--concurrency") ?? DEFAULT_CONCURRENCY);

  const config = await getAiConfig();
  const spentBefore = await getTotalSpendUsd();
  console.log(`Ngành: ${vertical} | model=${config.model} | trần $${config.spendCapUsd} | đã tiêu $${spentBefore.toFixed(4)}`);

  // Buildable = has keyword data AND has collected government data. Same
  // definition the dataset API uses, so this never generates copy for a
  // market a site cannot build a page for.
  const identities = await prisma.marketIdentity.findMany({ where: { vertical }, include: { keywordMetrics: true } });
  const buildable: string[] = [];
  for (const i of identities) {
    if (!computeTrafficValues(i.keywordMetrics)) continue;
    if ((await getRealDataPointsForZipAndVertical(i.zip, vertical)).length === 0) continue;
    buildable.push(i.zip);
  }

  // Cluster key mirrors what the consuming site groups pages by:
  // the county-level keyword when one has been measured (NYC boroughs),
  // otherwise the zip's own keyword, scoped to the state.
  let eligible = buildable;
  if (standaloneOnly) {
    const keyByZip = new Map<string, string>();
    for (const i of identities) {
      if (!buildable.includes(i.zip)) continue;
      const countyKeyword = await getCountyKeywordForZip(i.zip, vertical);
      const effective = countyKeyword?.keyword ?? latestPerKeyword(i.keywordMetrics)[0]?.keyword ?? "";
      keyByZip.set(i.zip, `${effective}::${i.state}`);
    }
    const countByKey = new Map<string, number>();
    for (const key of keyByZip.values()) countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    eligible = buildable.filter((z) => countByKey.get(keyByZip.get(z) ?? "") === 1);
    console.log(`--standalone-only: ${eligible.length}/${buildable.length} zip có trang riêng (bỏ ${buildable.length - eligible.length} zip nằm chung trang cụm)`);
  }

  const alreadyDone = new Set(
    (await prisma.aiGeneration.findMany({ where: { vertical, validationPassed: true }, select: { zip: true } })).map((r) => r.zip)
  );
  const todo = eligible.filter((z) => !alreadyDone.has(z)).slice(0, limit);

  console.log(`đủ điều kiện ${eligible.length} | đã có ${eligible.filter((z) => alreadyDone.has(z)).length} | sẽ sinh ${todo.length} (concurrency ${concurrency})\n`);
  if (todo.length === 0) {
    console.log("Không còn gì để sinh.");
    return;
  }

  let generated = 0;
  let rejected = 0;
  let failed = 0;
  let capHit = false;
  const rejections: { zip: string; rules: string }[] = [];
  const failures: { zip: string; message: string }[] = [];

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (capHit) return;
      const index = cursor++;
      if (index >= todo.length) return;
      const zip = todo[index];
      try {
        const outcome = await getOrGenerateInterpretation(vertical, zip);
        if (!outcome) {
          failed++;
          failures.push({ zip, message: "không dựng được FactSet" });
        } else if (outcome.validation.passed) {
          generated++;
        } else {
          // Not a crash: the model wrote something unsupported and the
          // validator refused it. Recorded so a pattern across zips is
          // visible rather than lost in a success count.
          rejected++;
          rejections.push({ zip, rules: outcome.validation.issues.map((i) => i.rule).join(",") });
        }
      } catch (err) {
        if (err instanceof SpendCapExceededError) {
          capHit = true;
          return;
        }
        failed++;
        failures.push({ zip, message: err instanceof Error ? err.message : String(err) });
      }
      const done = generated + rejected + failed;
      if (done % 10 === 0 || done === todo.length) {
        const spent = await getTotalSpendUsd();
        console.log(`  ${done}/${todo.length} — đạt ${generated}, bị chặn ${rejected}, lỗi ${failed} — đã tiêu $${spent.toFixed(3)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  const spentAfter = await getTotalSpendUsd();
  console.log(`\n=== KẾT QUẢ ===`);
  console.log(`  sinh thành công : ${generated}`);
  console.log(`  bị validator chặn: ${rejected}`);
  console.log(`  lỗi kỹ thuật    : ${failed}`);
  console.log(`  chi phí đợt này : $${(spentAfter - spentBefore).toFixed(4)} (tổng $${spentAfter.toFixed(4)} / trần $${config.spendCapUsd})`);
  if (capHit) {
    console.log(`\n⚠️  DỪNG VÌ CHẠM TRẦN CHI TIÊU. Chạy lại sau khi nâng spendCapUsd ở AppConfig key "ai" — các zip đã xong sẽ được bỏ qua.`);
  }
  if (rejections.length > 0) {
    console.log(`\nBị chặn (${rejections.length}) — đây là cơ chế hoạt động đúng, nhưng nếu tập trung ở một luật thì là vấn đề prompt:`);
    const byRule = new Map<string, number>();
    for (const r of rejections) byRule.set(r.rules, (byRule.get(r.rules) ?? 0) + 1);
    for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} × ${rule}`);
    console.log(`  zip: ${rejections.slice(0, 15).map((r) => r.zip).join(", ")}${rejections.length > 15 ? " …" : ""}`);
  }
  if (failures.length > 0) {
    console.log(`\nLỗi kỹ thuật (${failures.length}):`);
    for (const f of failures.slice(0, 10)) console.log(`  ${f.zip}: ${f.message.slice(0, 100)}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
