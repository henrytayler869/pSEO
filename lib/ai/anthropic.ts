import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/prisma";
import { getCredential } from "@/lib/settings/credentials";

/** Per-million-token USD pricing, used to turn the token counts the API
 * reports back into a real spend figure. Anthropic's published rates as of
 * 2026-09; if they change, the ledger silently drifts, so the model key is
 * stored on every AiSpend row to make a later correction possible. */
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_SPEND_CAP_USD = 5.0;
const MAX_OUTPUT_TOKENS = 1024; // one 200-400 word paragraph; not a long-form job

export class SpendCapExceededError extends Error {
  constructor(
    message: string,
    public readonly spentUsd: number,
    public readonly capUsd: number
  ) {
    super(message);
    this.name = "SpendCapExceededError";
  }
}

export interface AiConfig {
  model: string;
  spendCapUsd: number;
  /** Adaptive thinking costs tokens but reduces rejected generations. See
   * the note in generateWithClaude() for why that is usually cheaper. */
  useThinking: boolean;
}

/** All three knobs live in AppConfig so spend behaviour can be changed
 * without a deploy — the cap especially, which someone may need to raise
 * or drop to zero in a hurry. */
export async function getAiConfig(): Promise<AiConfig> {
  const row = await prisma.appConfig.findUnique({ where: { key: "ai" } });
  const cfg = (row?.value ?? {}) as Partial<AiConfig>;
  return {
    model: cfg.model ?? DEFAULT_MODEL,
    spendCapUsd: cfg.spendCapUsd ?? DEFAULT_SPEND_CAP_USD,
    useThinking: cfg.useThinking ?? true,
  };
}

export async function getTotalSpendUsd(): Promise<number> {
  const agg = await prisma.aiSpend.aggregate({ _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING_PER_MTOK[model];
  // An unknown model is priced at the most expensive known rate rather than
  // free: a model whose cost we can't compute must not be able to slip past
  // the cap by appearing to cost nothing.
  const rate = p ?? { input: 5.0, output: 25.0 };
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
}

export interface GenerationResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * One Claude call, with the spend ceiling enforced BEFORE the request goes
 * out — a cap checked afterwards is not a cap.
 *
 * Written against the official @anthropic-ai/sdk (v0.123) and Anthropic's
 * documented Messages API.
 *
 * This block used to say "not yet exercised against a live call: no
 * ANTHROPIC_API_KEY exists in this environment yet". That stopped being true
 * and nobody updated it — measured 2026-09-11: the key is configured, 305
 * calls have been billed, $5.3967 spent. The comment was read as current
 * state and reported as fact, which is what a stale comment does: it does not
 * look stale, it looks like knowledge.
 *
 * Adaptive thinking is on by default even though it costs tokens. The task
 * is constraint-heavy — every invented number gets the whole generation
 * rejected by the validator — and a rejection costs a full retry, so paying
 * for care up front is usually cheaper than paying for the retry. Set
 * `useThinking: false` in the AppConfig "ai" key to turn it off.
 */
export async function generateWithClaude(params: {
  system: string;
  prompt: string;
  vertical: string;
  /** Null for an editorial article, which spans many ZIPs. */
  zip: string | null;
  /** Set for article generation so cost is attributable per publisher and per
   * article. The ledger row is written either way — this only says WHOSE. */
  websiteId?: string | null;
  articleId?: string | null;
}): Promise<GenerationResult> {
  const apiKey = await getCredential("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Chưa cấu hình ANTHROPIC_API_KEY (ở trang Cài đặt hoặc biến môi trường) — không thể sinh nội dung AI."
    );
  }

  const config = await getAiConfig();
  const spent = await getTotalSpendUsd();
  if (spent >= config.spendCapUsd) {
    throw new SpendCapExceededError(
      `Đã chạm trần chi tiêu AI: đã tiêu $${spent.toFixed(4)} / trần $${config.spendCapUsd.toFixed(2)}. ` +
        `Không gọi thêm. Nâng trần ở AppConfig key "ai" (trường spendCapUsd) nếu thực sự muốn tiếp tục.`,
      spent,
      config.spendCapUsd
    );
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: config.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
    ...(config.useThinking ? { thinking: { type: "adaptive" as const } } : {}),
  });

  // Only the text blocks are content; thinking blocks are reasoning, never
  // page copy, and must not reach the validator or the site.
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const cost = costUsd(config.model, inputTokens, outputTokens);

  // Recorded regardless of whether the text later passes validation — the
  // money was spent either way, and a ledger that only counts successes
  // would under-report exactly when things are going wrong.
  await prisma.aiSpend.create({
    data: {
      vertical: params.vertical,
      zip: params.zip,
      websiteId: params.websiteId ?? null,
      articleId: params.articleId ?? null,
      model: config.model,
      inputTokens,
      outputTokens,
      costUsd: cost,
    },
  });

  return { text, model: config.model, inputTokens, outputTokens, costUsd: cost };
}
