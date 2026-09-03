/** Bounded-concurrency `Promise.all`: runs `fn` over `items` at most `limit` at once, keeping input order — keeps per-file test commands from fork-bombing the box. */
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
