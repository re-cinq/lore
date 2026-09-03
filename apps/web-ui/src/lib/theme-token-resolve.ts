// Resolves theme tokens to literal colors (canvas/d3 need it; SVG/JSX keep var()).

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
