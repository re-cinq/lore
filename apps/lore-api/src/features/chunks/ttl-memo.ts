// Memoize zero-arg async function for ttlMs; concurrent callers share one invocation.
export function memoizeWithTtl<T>(
  fn: () => Promise<T>,
  ttlMs: number,
): () => Promise<T> {
  let cached: Promise<T> | null = null;
  let cachedAt = 0;

  return () => {
    if (cached && Date.now() - cachedAt < ttlMs) {
      return cached;
    }
    cachedAt = Date.now();
    const invocation: Promise<T> = fn().catch((err: unknown) => {
      // Identity check: a slow rejection must not evict a newer cache entry.
      if (cached === invocation) {
        cached = null;
      }
      throw err;
    });

    cached = invocation;

    return invocation;
  };
}
