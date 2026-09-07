import { requireApiKey } from "@/lib/api/auth";
import { apiJson } from "@/lib/api/cache-policy";

/**
 * GET /api/v1/version — which commit is this server actually running?
 *
 * The deploy pipeline reports success, but "the workflow went green" and "the
 * running process is serving that commit" are different claims, and until now
 * only the first was observable from outside. Confirming the second meant
 * asking someone to log into the machine, which makes the answer depend on a
 * person being available and on trusting their report.
 *
 * Both values are baked at build time (see next.config.ts), so they describe
 * the build being served — not what happens to be checked out on disk right
 * now, which can differ if a deploy failed partway or someone ran git by hand.
 *
 * Behind the API key like every other /api/v1 route: this is a private
 * repository, and the exact commit is not something to hand to anyone who
 * asks.
 */
export async function GET(request: Request) {
  const unauthorized = await requireApiKey(request);
  if (unauthorized) return unauthorized;

  return apiJson({
    commit: process.env.PSEO_COMMIT ?? "unknown",
    builtAt: process.env.PSEO_BUILT_AT ?? null,
  });
}
