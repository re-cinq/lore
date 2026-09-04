/** Copies each of `keys` from `incoming` onto `upstream` when present, leaving the rest of `upstream`'s query untouched. */
export function forwardQueryParams(
  incoming: URL,
  upstream: URL,
  keys: string[],
): void {
  for (const key of keys) {
    const value = incoming.searchParams.get(key);

    if (value !== null) {
      upstream.searchParams.set(key, value);
    }
  }
}
