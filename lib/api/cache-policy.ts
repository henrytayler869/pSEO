/**
 * Cache policy for the public dataset API — declared by the server, not left
 * to each consumer's HTTP stack to invent.
 *
 * Sending no cache headers at all does not mean "do not cache". It means
 * every client picks its own policy, and framework defaults are rarely the
 * one you want. A consuming Next.js site hit exactly this: its `fetch()`
 * layer kept a second, URL-keyed cache in `.next/cache`, surviving across
 * builds and carrying no tags, so nothing could address it — not
 * `revalidateTag`, not changing the key of the `use cache` wrapper around it.
 * One page picked up regenerated text and another kept the old copy in the
 * SAME build. Which one you got depended on whichever entry happened to have
 * expired.
 *
 * That is the worst shape a bug can take here: the stale page renders
 * perfectly, states real measured figures, and looks identical to the correct
 * one. The site patched it on their end, but the next consumer would have
 * discovered it the same way — by noticing a number that should have changed
 * and didn't. So the policy belongs here, once, where every consumer gets it.
 *
 * Why `no-store` rather than a short max-age:
 *
 * The expensive work is already cached server-side. Generated text lives in
 * AiGeneration and measured figures live in DataPoint, so answering a request
 * is a database read, not a model call — there is nothing to protect with an
 * HTTP cache. What an HTTP cache WOULD buy is a window in which a consumer
 * serves content this app has already superseded, and this dataset gets
 * superseded for reasons a consumer cannot see: a collection run, a rescore,
 * or copy regenerated because a prompt rule changed. Trading correctness for
 * a saved database read is the wrong side of that bargain.
 *
 * Consumers are still free to cache — the site does, deliberately and with
 * tags it can invalidate. The point is that caching becomes THEIR decision,
 * made once and addressable, instead of something a transport layer does
 * silently on their behalf.
 */
export const NO_STORE_HEADERS = {
  // no-store: do not write to any cache. no-cache and must-revalidate are
  // redundant alongside it, but intermediaries and older stacks honour
  // different subsets, and this endpoint is consumed by clients we do not
  // control.
  "Cache-Control": "no-store, no-cache, must-revalidate",
  // Some CDNs and proxies still act on this.
  Pragma: "no-cache",
} as const;

/** Response.json with the dataset API's cache policy attached.
 *
 * Used for EVERY response including errors: a cached 422 or 429 outlives the
 * condition that caused it, so a consumer would keep seeing "spend cap
 * reached" after the cap was raised. */
export function apiJson(body: unknown, init?: { status?: number }): Response {
  return Response.json(body, { status: init?.status ?? 200, headers: NO_STORE_HEADERS });
}
