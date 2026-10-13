/** The page size a run read asks for. A limit that is no positive whole number reads as the default, so a malformed query pages like an unqualified one, as the Floor's own reads did; it also never reaches Postgres as a LIMIT, which refuses a negative or fractional one. */
export function pageLimit(
  value: unknown,
  bounds: { fallback: number; max: number },
): number {
  const asked = Number(value);

  return Number.isInteger(asked) && asked > 0
    ? Math.min(asked, bounds.max)
    : bounds.fallback;
}
