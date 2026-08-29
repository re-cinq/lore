/**
 * Memoize an async factory per key.
 *
 * The PROMISE is cached, not the resolved value, so concurrent callers for the
 * same key share one in-flight build instead of racing to construct duplicates —
 * which is the case that matters here: several handlers ask for the same repo's
 * Project within one event.
 *
 * A rejection is forgotten. Caching a failed build would make one transient
 * error permanent for the process's whole life, which is strictly worse than
 * the rebuild it was meant to save.
 */
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
