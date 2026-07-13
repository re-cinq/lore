/**
 * Bounded-concurrency `Promise.all`: maps `items` through `fn` running at most
 * `limit` tasks at once, returning results in input order. Used by the
 * spec-traceability test orchestrators so running per-file test commands can't
 * fork-bomb the box (the reason the runner previously collapsed to one descriptor
 * per file).
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;

      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
