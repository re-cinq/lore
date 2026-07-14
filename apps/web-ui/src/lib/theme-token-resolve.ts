// Canvas fillStyle/strokeStyle and d3 color interpolators cannot resolve
// var() references, so chart code resolves theme tokens to literal colors
// through these helpers once per render, from a computed-style lookup.
// SVG attributes and JSX styles keep the raw var() references.

export type TokenLookup = (name: string) => string;

export const cssToken = (
  lookup: TokenLookup,
  name: string,
  fallback: string,
): string => lookup(name).trim() || fallback;

export const resolveColor = (
  lookup: TokenLookup,
  value: string,
  fallback = "#94a3b8",
): string =>
  value.startsWith("var(")
    ? cssToken(lookup, value.slice(4, -1), fallback)
    : value;
