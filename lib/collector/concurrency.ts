/** Runs `fn` over `items` with at most `limit` in flight at once. Checks
 * `shouldAbort()` between dispatches so an in-progress schema-drift abort
 * (see run.ts) stops scheduling new work without needing a cancellation
 * token threaded through every adapter call. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  shouldAbort: () => boolean = () => false
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length && !shouldAbort()) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
