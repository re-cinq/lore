/** Memoize an async factory per key: caches the PROMISE (so concurrent callers share one in-flight build) and forgets rejections, but has NO eviction/invalidation — safe only for `projectFor`'s bounded, always-usable key space, not a general-purpose cache. */
export function memoizePerKey<T>(
  build: (key: string) => Promise<T>,
): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();

  return (key) => {
    const inFlight = cache.get(key);

    if (inFlight) {
      return inFlight;
    }
    const pending = build(key).catch((err: unknown) => {
      cache.delete(key);

      throw err;
    });

    cache.set(key, pending);

    return pending;
  };
}
