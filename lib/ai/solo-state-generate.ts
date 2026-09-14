import { prisma } from "@/lib/db/prisma";
import { generateWithClaude } from "@/lib/ai/anthropic";
import { clusterIdOf, type ClusterFactSet } from "@/lib/ai/cluster-facts";
import { buildSoloStateFactSet, type ZipPool } from "@/lib/ai/solo-state-facts";
import { validateClusterText } from "@/lib/ai/cluster-validate";
import { judgeDistinctness, MAX_SHARED_RUN_WORDS } from "@/lib/ai/distinctness";

/**
 * Đoạn cho hub của bang chỉ có MỘT ZIP.
 *
 * Dùng lại validator dải (validateClusterText) và bảng lưu của cụm, nhưng
 * prompt riêng — vì khẳng định cần viết là khác hẳn: không phải "dải trong
 * vùng này" mà "ZIP này đứng đâu trong tập đã publish".
 *
 * ⚠️ Nguy cơ riêng của đường này: trang ZIP nằm NGAY DƯỚI hub, và nó đã có
 * đoạn diễn giải của riêng nó về cùng những con số. Hai đoạn nói về cùng
 * một ZIP, đăng cách nhau một cú bấm. Nên ngoài validator sự thật, đoạn này
 * còn phải qua phép ĐO ĐỘ TRÙNG với đoạn của chính trang ZIP đó — cùng cổng
 * đã dựng cho việc sinh lại khi dựng site mới.
 */

const MAX_ATTEMPTS = 3;

const SYSTEM = `You write ONE short paragraph for a STATE hub page that publishes exactly ONE ZIP code.

The page links to that ZIP's own page, which already states its figures and interprets them. Your paragraph must NOT repeat that interpretation. It exists to say the one thing the ZIP page cannot say: where this ZIP sits among all the ZIP codes this site publishes.

HARD RULES — a violation means the draft is rejected:
1. Every number you write MUST appear in the FACTS list, written as its "display" string shows it. Never add, change or invent a digit.
2. This ZIP is NOT the state. Never write "homeownership in Ohio is 54%" — one ZIP does not describe a state. Say "ZIP 43215, the only Ohio ZIP published here".
3. The comparison set is the ZIP codes THIS SITE publishes, not the country. Say so. "Higher than most of the US" is forbidden; "higher than 112 of the 157 ZIP codes published here" is what the facts support.
4. Never state or imply anything about what moving companies charge, how busy they are, or what a typical job involves. No dataset here measures suppliers. You may address the READER — what to ask, what to confirm.
5. Figures measured at county or state level DO describe a wider area. Say which, in the same sentence.
6. Do not mention keywords, search volume, SEO or ranking.

Output PLAIN TEXT. No HTML, no markdown. Three to four sentences.`;

function buildPrompt(set: ClusterFactSet, previous: { text: string; issues: string[] } | null): string {
  const where = [set.city, set.state].filter(Boolean).join(", ");
  const base = `AREA: ${set.label} — a state hub page covering exactly one published ZIP code (${set.memberZips[0]}${where ? `, ${where}` : ""}).
READER INTENT: ${set.searchIntent ?? "not measured"}

FACTS — the only numbers you may use:
${set.facts.map((f) => `- ${f.label} | display: "${f.display}" | measured at: ${f.scope}${f.scopeName ? ` (${f.scopeName})` : ""}`).join("\n")}`;

  if (!previous) return base;
  return `${base}

Your previous paragraph FAILED these checks:

${previous.issues.map((i) => `- ${i}`).join("\n")}

Your previous paragraph:
${previous.text}

Rewrite it to fix those, changing as little else as possible.`;
}

export interface SoloStateOutcome {
  label: string;
  text: string | null;
  passed: boolean;
  attempts: number;
  costUsd: number;
  issues: string[];
  /** Mạch trùng dài nhất với đoạn của chính trang ZIP. */
  sharedWithZipPage: number;
}

export async function generateForSoloState(
  vertical: string,
  zip: string,
  label: string,
  pool: ZipPool,
  websiteId?: string | null
): Promise<SoloStateOutcome | null> {
  const set = await buildSoloStateFactSet(vertical, zip, label, pool);
  if (!set) return null;

  const clusterId = clusterIdOf(vertical, [zip]);
  const cached = await prisma.aiClusterGeneration.findFirst({
    where: { vertical, clusterId, factsFingerprint: set.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
  });
  if (cached) return { label, text: cached.text, passed: true, attempts: 0, costUsd: 0, issues: [], sharedWithZipPage: 0 };

  // Đoạn của chính trang ZIP — thứ đoạn này KHÔNG được viết lại.
  const zipPage = await prisma.aiGeneration.findFirst({
    where: { vertical, zip, validationPassed: true },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  const priors = zipPage ? [zipPage.text] : [];

  let previous: { text: string; issues: string[] } | null = null;
  let cost = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = await generateWithClaude({ system: SYSTEM, prompt: buildPrompt(set, previous), vertical, zip, websiteId: websiteId ?? null });
    cost += r.costUsd;

    const truth = validateClusterText(r.text, set);
    const distinct = judgeDistinctness(r.text, priors);
    const issues = [
      ...truth.issues.map((i) => `[${i.rule}] ${i.detail}`),
      ...(distinct.ok
        ? []
        : [`[echoes-zip-page] Trùng ${distinct.worstWords} từ liên tiếp (trần ${MAX_SHARED_RUN_WORDS}) với đoạn của chính trang ZIP: "${distinct.worstPhrase}"`]),
    ];
    const passed = issues.length === 0;

    await prisma.aiClusterGeneration.create({
      data: {
        vertical,
        clusterId,
        label,
        memberZips: [zip],
        factsFingerprint: set.fingerprint,
        prompt: buildPrompt(set, previous),
        text: r.text,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        validationPassed: passed,
        validationNotes: passed ? null : issues.join(" | "),
      },
    });

    if (passed) return { label, text: r.text, passed: true, attempts: attempt, costUsd: cost, issues: [], sharedWithZipPage: distinct.worstWords };
    previous = { text: r.text, issues };
  }

  return { label, text: null, passed: false, attempts: MAX_ATTEMPTS, costUsd: cost, issues: previous?.issues ?? [], sharedWithZipPage: 0 };
}
