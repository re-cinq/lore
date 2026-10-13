/** Memoize an async lookup per key for `ttlMs`: answers (null included) are reused until they age out, rejections are forgotten so the next call asks again. The digest's people lookups go through it, so a Slack rename or a newly granted scope shows up within a day, not only after a Floor restart. */
export function ttlMemo<T>(
  lookup: (key: string) => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): (key: string) => Promise<T> {
  const cache = new Map<string, { at: number; answer: Promise<T> }>();

  return (key) => {
    const hit = cache.get(key);

    if (hit && now() - hit.at < ttlMs) {
      return hit.answer;
    }
    const answer = lookup(key).catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });

    cache.set(key, { at: now(), answer });

    return answer;
  };
}
