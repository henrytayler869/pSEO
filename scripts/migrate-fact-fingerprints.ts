// One-off migration: re-key cached interpretations onto the canonical fact
// fingerprint.
//
// The fingerprint hashes the fact list as a SEQUENCE, and the sequence came
// from an unordered database read — so re-collecting byte-identical data
// could produce a different fingerprint, which downstream means "the numbers
// changed". Sorting the input fixes that permanently, but it also moves every
// existing fingerprint exactly once.
//
// Without this migration that one-time move would cost real money: 148 stored
// paragraphs would become cache misses and be regenerated to say the same
// thing about the same numbers, roughly $3 for no change in output.
//
// The safety condition is not "the fingerprint used to match" — that is
// precisely what is being invalidated. It is: does the STORED TEXT still pass
// validation against the CURRENT facts? Validation checks every number in the
// text against the measured set, so a pass means the paragraph is true of the
// data as it stands now, whatever fingerprint it was born under. Anything
// that fails is left alone to be regenerated properly.
//
// Usage: tsx scripts/migrate-fact-fingerprints.ts [--apply]

import { prisma } from "../lib/db/prisma";
import { buildFactSet } from "../lib/ai/facts";
import { validateGeneratedText } from "../lib/ai/validate";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "CHẾ ĐỘ GHI THẬT" : "CHẠY THỬ (thêm --apply để ghi)");

  const rows = await prisma.aiGeneration.findMany({
    where: { validationPassed: true },
    orderBy: { createdAt: "desc" },
  });

  let migrated = 0;
  let alreadyCurrent = 0;
  let invalidated = 0;
  const failures: { zip: string; rules: string }[] = [];

  for (const row of rows) {
    const factSet = await buildFactSet(row.vertical, row.zip);
    if (!factSet) continue;

    if (factSet.fingerprint === row.factsFingerprint) {
      alreadyCurrent++;
      continue;
    }

    const check = validateGeneratedText(row.text, factSet);
    if (!check.passed) {
      // The text does not describe today's facts. Not a migration candidate —
      // leave the row alone so the normal path regenerates it.
      invalidated++;
      failures.push({ zip: row.zip, rules: check.issues.map((i) => i.rule).join(",") });
      continue;
    }

    if (apply) {
      await prisma.aiGeneration.update({
        where: { id: row.id },
        data: { factsFingerprint: factSet.fingerprint },
      });
    }
    migrated++;
  }

  console.log(`\n  đã đúng fingerprint hiện hành : ${alreadyCurrent}`);
  console.log(`  di trú được (văn vẫn đúng)    : ${migrated}`);
  console.log(`  KHÔNG di trú (văn không còn đạt): ${invalidated}`);
  for (const f of failures.slice(0, 10)) console.log(`    ${f.zip}: ${f.rules}`);
  if (!apply && migrated > 0) console.log(`\nChạy lại với --apply để ghi.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
