import { requireApiKey } from "@/lib/api/auth";
import { getOrGenerateInterpretation, getCachedInterpretation, fingerprintText } from "@/lib/ai/generate";
import { SpendCapExceededError, getTotalSpendUsd, getAiConfig } from "@/lib/ai/anthropic";
import { apiJson } from "@/lib/api/cache-policy";

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

  // Reading NEVER spends. Generating is opt-in via ?generate=1.
  //
  // This default was the other way round for one day, and one day was enough
  // to show why it is wrong. A consuming session probing a single zip bought
  // a generation for a market that deliberately has none. Adding
  // ?cachedOnly=1 fixed that call — and then the same session found the leak
  // was not a one-off at all: two of its routine scripts iterate all 127
  // published markets through this endpoint, so every market this app had not
  // written copy for would be written by the consumer's next run, silently,
  // on a schedule.
  //
  // A parameter you must remember to pass is not protection; it is a trap
  // with a workaround. If every consumer needs cachedOnly on every call, that
  // is the default asking to be changed. Spending money is now something a
  // caller asks for in writing.
  //
  // The boundary this settles: THIS APP decides what gets generated (batch
  // scripts, deliberately, against a spend cap it can see). Consumers decide
  // what gets rendered. Cost stops depending on when somebody presses build.
  //
  // cachedOnly=1 is still accepted and now redundant — kept so the consumer
  // that adopted it does not break.
  const params = new URL(request.url).searchParams;
  const mayGenerate = params.get("generate") === "1" && params.get("cachedOnly") !== "1";

  try {
    const outcome = mayGenerate
      ? await getOrGenerateInterpretation(vertical, zip)
      : await getCachedInterpretation(vertical, zip);
    if (!outcome) {
      // Two different absences, told apart explicitly. A consumer polling for
      // "has this been generated yet" must not read "this market does not
      // exist" as the same answer.
      return apiJson(
        {
          error: mayGenerate
            ? `No researched market with keyword data for vertical "${vertical}", zip "${zip}".`
            : `No cached interpretation for vertical "${vertical}", zip "${zip}" — nothing generated yet, or the stored text no longer passes today's validation. Pass ?generate=1 to generate one (this spends money).`,
          // Two different absences, and they resolve differently: not_cached
          // clears itself on this app's next batch, while no_market_data means
          // the zip should not have a page at all. Collapsing them would let
          // the second hide inside the first, and a zip that ought to be
          // dropped from an inventory would look like one that is merely
          // waiting.
          reason: mayGenerate ? "no_market_data" : "not_cached",
        },
        { status: 404 });
    }

    if (!outcome.validation.passed) {
      return apiJson(
        {
          error: "Generated text failed fact validation and was not served.",
          issues: outcome.validation.issues,
          attempts: outcome.attempts,
          hint: "Không phải lỗi tạm thời — thử lại thường cho kết quả như cũ. Xem AiGeneration để đọc text bị chặn và prompt đã dùng.",
        },
        { status: 422 });
    }

    return apiJson({
      vertical,
      zip,
      text: outcome.text,
      cached: outcome.cached,
      // Changes whenever any underlying figure changes. A consumer that
      // stores this can tell its cached copy is describing stale numbers
      // without having to diff the numbers themselves.
      factsFingerprint: outcome.factsFingerprint,
      // Changes whenever the TEXT changes, including when the figures did
      // not. Copy gets regenerated for reasons no consumer can observe — a
      // prompt rule tightening, for instance — and factsFingerprint stays
      // identical through that, so a site keying staleness on facts alone
      // silently keeps a superseded paragraph. This is the field to compare
      // when the question is "is what I stored still what would be served".
      textFingerprint: fingerprintText(outcome.text),
    });
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      return apiJson(
        {
          error: err.message,
          spentUsd: err.spentUsd,
          capUsd: err.capUsd,
        },
        { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Sinh nội dung thất bại.";
    // A missing key is a configuration problem, not a server fault — say so
    // plainly rather than returning an opaque 500.
    const status = message.includes("ANTHROPIC_API_KEY") ? 503 : 500;
    return apiJson({ error: message, ...(status === 503 ? await spendContext() : {}) }, { status });
  }
}

async function spendContext() {
  const [spentUsd, config] = await Promise.all([getTotalSpendUsd(), getAiConfig()]);
  return { spentUsd, capUsd: config.spendCapUsd, model: config.model };
}
