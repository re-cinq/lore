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
 *
 * NO EVICTION, and no invalidation. A resolved value is held for the life of
 * the process, so this is only safe where the key space is bounded and the
 * value stays usable — both true of its one caller (`projectFor`: one entry per
 * onboarded repo, and the Octokit inside refreshes its own installation token,
 * which is the thing worth keeping). It is NOT a general-purpose cache: a
 * caller with unbounded keys grows forever, and one whose values can go
 * permanently invalid — a GitHub App uninstalled from a repo, say — has no way
 * to drop the stale one short of a restart. Either need means a real cache with
 * a TTL, not this.
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
