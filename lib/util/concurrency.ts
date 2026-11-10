export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Runs `task` over `items` with at most `limit` running at once. Results keep input order.
 * A failing task doesn't stop the others; each result says whether it succeeded.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  task: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const results: Settled<O>[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await task(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
