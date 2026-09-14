import { prisma } from "@/lib/db/prisma";
import { generateWithClaude } from "@/lib/ai/anthropic";
import { buildClusterFactSet, clusterIdOf, type ClusterFactSet } from "@/lib/ai/cluster-facts";
import { validateClusterText } from "@/lib/ai/cluster-validate";

/**
 * Đoạn diễn giải cho một trang CỤM.
 *
 * Trang cụm gộp nhiều ZIP vào một trang, nên nó không có "giá trị của nơi
 * này" — và chính vì thế 31 trang cụm của publisher hiện 100% template, trong
 * khi chúng giữ những từ khoá lớn nhất (moving companies new york, 18.100
 * lượt/tháng, nằm ở đúng một trang cụm).
 *
 * Thứ trang cụm nói được mà không trang ZIP nào nói nổi là DẢI: tỷ lệ sở hữu
 * nhà ở Brooklyn chạy từ 10,9% đến 67,3% tuỳ ZIP. Một trang ZIP chỉ có một
 * con số nên nó không biết mình nằm đâu trong quận.
 */

const MAX_ATTEMPTS = 3;

const SYSTEM = `You write ONE short paragraph for a page that covers MANY ZIP codes at once — a whole borough or city, not one postcode.

The page already has its heading, its table comparing every ZIP, and its source note. Your paragraph is the part that says what the comparison MEANS.

HARD RULES — a violation means the draft is rejected:
1. Every number you write MUST appear in the FACTS list, written as its "display" string shows it. You may drop decimal places; you may never add a digit, change a digit, or invent a figure.
2. Most figures below are the ENDS OF A RANGE across the ZIP codes. Never state one as if it described the whole area. "Homeownership here is 10.9%" is FORBIDDEN — that is one ZIP out of many. Write it as a range, or name the ZIP it belongs to.
3. Figures marked as measured at county level DO describe the whole area. Say so in the same sentence.
4. Never state or imply anything about what moving companies charge, how busy they are, or what a typical job involves. No dataset here measures suppliers. You may address the READER — what to ask, what to confirm.
5. Do not repeat the table. The point of the paragraph is the SPREAD: which figures vary a lot across the area, which barely vary, and what that means for someone planning a move here.
6. Do not mention keywords, search volume, SEO or ranking.

Output PLAIN TEXT. No HTML, no markdown. Three to five sentences.`;

function factsBlock(set: ClusterFactSet): string {
  return set.facts
    .map((f) => `- ${f.label} | display: "${f.display}" | measured at: ${f.scope}${f.scopeName ? ` (${f.scopeName})` : ""}`)
    .join("\n");
}

function buildPrompt(set: ClusterFactSet, previous: { text: string; issues: string[] } | null): string {
  const base = `AREA: ${set.label} — one page covering ${set.memberZips.length} ZIP codes${set.county ? ` in ${set.county}` : ""}.
READER INTENT: ${set.searchIntent ?? "not measured"}

FACTS — the only numbers you may use. Most are the LOW and HIGH end of a range across those ZIP codes:
${factsBlock(set)}`;

  if (!previous) return base;

  // Gửi lại đoạn cũ nguyên văn cùng lỗi, không xin một đoạn mới: xin mới sẽ
  // mất phần đã đúng, và lần sau hỏng chỗ khác — vòng lặp thôi hội tụ và bắt
  // đầu đi vòng.
  return `${base}

Your previous paragraph FAILED these checks:

${previous.issues.map((i) => `- ${i}`).join("\n")}

Your previous paragraph:
${previous.text}

Rewrite it to fix those, changing as little else as possible.`;
}

export interface ClusterGenerateOutcome {
  clusterId: string;
  label: string;
  text: string | null;
  attempts: number;
  costUsd: number;
  passed: boolean;
  issues: string[];
}

/**
 * Đọc bản đã sinh cho cụm này, nếu fingerprint còn khớp.
 *
 * Fingerprint gồm cả tập ZIP thành viên: cụm thêm hay bớt một ZIP thì dải
 * đổi, nên bản cũ không còn đúng và phải sinh lại. Không có điều đó thì một
 * cụm mở rộng vẫn trả về đoạn văn mô tả dải cũ — im lặng, vì cache "hợp lệ".
 */
export async function getCachedClusterText(vertical: string, memberZips: string[]): Promise<string | null> {
  const set = await buildClusterFactSet(vertical, memberZips, "");
  if (!set) return null;
  const row = await prisma.aiClusterGeneration.findFirst({
    where: { vertical, factsFingerprint: set.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
    select: { text: true },
  });
  return row?.text ?? null;
}

export async function generateForCluster(
  vertical: string,
  memberZips: string[],
  label: string,
  /**
   * Publisher chịu chi phí này.
   *
   * Đoạn cấp cụm KHÁC đoạn theo ZIP ở chỗ nó thuộc về một site cụ thể:
   * thành viên cụm lấy từ /api/inventory của chính site đó, nên hai
   * publisher cùng niche sẽ có cụm khác nhau và cần đoạn khác nhau. Đoạn
   * theo ZIP thì ngược lại — cache theo niche, phục vụ mọi site.
   *
   * Không gắn thì hàng "gắn đích danh site này" trong thẻ ngân sách mãi là
   * $0,0000: một hàng luôn bằng 0 dạy người đọc bỏ qua nó.
   */
  websiteId?: string | null
): Promise<ClusterGenerateOutcome | null> {
  const set = await buildClusterFactSet(vertical, memberZips, label);
  if (!set) return null;
  const clusterId = clusterIdOf(vertical, memberZips);

  const cached = await prisma.aiClusterGeneration.findFirst({
    where: { vertical, factsFingerprint: set.fingerprint, validationPassed: true },
    orderBy: { createdAt: "desc" },
  });
  if (cached) {
    return { clusterId, label, text: cached.text, attempts: 0, costUsd: 0, passed: true, issues: [] };
  }

  let previous: { text: string; issues: string[] } | null = null;
  let cost = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(set, previous);
    const result = await generateWithClaude({ system: SYSTEM, prompt, vertical, zip: null, websiteId: websiteId ?? null });
    cost += result.costUsd;

    const text = result.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const verdict = validateClusterText(text, set);
    const issues = verdict.issues.map((i) => `[${i.rule}] ${i.detail}`);

    // Lưu CẢ bản trượt, kèm lý do — một bản bị từ chối là bằng chứng về
    // prompt, và vứt lặng lẽ sẽ giấu một vấn đề có hệ thống.
    await prisma.aiClusterGeneration.create({
      data: {
        vertical,
        clusterId,
        label,
        memberZips: set.memberZips,
        factsFingerprint: set.fingerprint,
        prompt,
        text,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        validationPassed: verdict.passed,
        validationNotes: verdict.passed ? null : issues.join(" | "),
      },
    });

    if (verdict.passed) return { clusterId, label, text, attempts: attempt, costUsd: cost, passed: true, issues: [] };
    previous = { text, issues };
  }

  return { clusterId, label, text: previous?.text ?? null, attempts: MAX_ATTEMPTS, costUsd: cost, passed: false, issues: previous?.issues ?? [] };
}
