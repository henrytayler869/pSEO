import { requireApiKey } from "@/lib/api/auth";
import { getOrGenerateInterpretation } from "@/lib/ai/generate";
import { SpendCapExceededError, getTotalSpendUsd, getAiConfig } from "@/lib/ai/anthropic";

/**
 * GET /api/v1/niches/{vertical}/markets/{zip}/interpretation
 *
 * Validated interpretation copy for one market. Exists so consuming sites
 * do NOT each hold an Anthropic key and — far more importantly — do not each
 * reimplement the anti-fabrication validator. One site already shipped a
 * hardcoded "roughly one resident in five" beside a measured 29.5%, in the
 * layer it believed could not invent numbers; N reimplementations means N
 * chances to reintroduce that.
 *
 * Text is only ever returned when it passes validation. A generation that
 * fails is reported as a 422 with the reasons, never served — an unvalidated
 * paragraph is the thing this endpoint exists to prevent.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/niches/[vertical]/markets/[zip]/interpretation">
) {
  const unauthorized = await requireApiKey(request);
  if (unauthorized) return unauthorized;

  const { vertical, zip } = await ctx.params;

  try {
    const outcome = await getOrGenerateInterpretation(vertical, zip);
    if (!outcome) {
      return Response.json(
        { error: `No researched market with keyword data for vertical "${vertical}", zip "${zip}".` },
        { status: 404 }
      );
    }

    if (!outcome.validation.passed) {
      return Response.json(
        {
          error: "Generated text failed fact validation and was not served.",
          issues: outcome.validation.issues,
          attempts: outcome.attempts,
          hint: "Không phải lỗi tạm thời — thử lại thường cho kết quả như cũ. Xem AiGeneration để đọc text bị chặn và prompt đã dùng.",
        },
        { status: 422 }
      );
    }

    return Response.json({
      vertical,
      zip,
      text: outcome.text,
      cached: outcome.cached,
      // Changes whenever any underlying figure changes. A consumer that
      // stores this can tell its cached copy is describing stale numbers
      // without having to diff the numbers themselves.
      factsFingerprint: outcome.factsFingerprint,
    });
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      return Response.json(
        {
          error: err.message,
          spentUsd: err.spentUsd,
          capUsd: err.capUsd,
        },
        { status: 429 }
      );
    }
    const message = err instanceof Error ? err.message : "Sinh nội dung thất bại.";
    // A missing key is a configuration problem, not a server fault — say so
    // plainly rather than returning an opaque 500.
    const status = message.includes("ANTHROPIC_API_KEY") ? 503 : 500;
    return Response.json({ error: message, ...(status === 503 ? await spendContext() : {}) }, { status });
  }
}

async function spendContext() {
  const [spentUsd, config] = await Promise.all([getTotalSpendUsd(), getAiConfig()]);
  return { spentUsd, capUsd: config.spendCapUsd, model: config.model };
}
