/** Canonical display order for the context content-type filter chips.
 * The chip SET is data-driven (only types actually present get a chip); this
 * just orders them. Unknown types sort after these, alphabetically. */
export const TYPE_ORDER = [
  "doc",
  "spec",
  "adr",
  "rule",
  "pull_request",
  "code",
] as const;

const BADGE_MOD: Record<string, string> = {
  doc: "badge-blue",
  spec: "badge-green",
  adr: "badge-yellow",
  rule: "badge-red",
  pull_request: "badge-gray",
  code: "badge-gray",
};

/** Full className for a content-type badge (`badge` + a color modifier). */
export function badgeClassForType(type: string): string {
  const mod = BADGE_MOD[type];
  return mod ? `badge ${mod}` : "badge";
}

/** Human label for a content-type chip (e.g. `pull_request` → `pull request`). */
export function labelForType(type: string): string {
  return type.replace(/_/g, " ");
}

/** Order detected content types by `TYPE_ORDER`, unknown types last (alpha). */
export function orderTypes(types: string[]): string[] {
  const rank = (t: string) => {
    const i = (TYPE_ORDER as readonly string[]).indexOf(t);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return [...types].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Build a context list href preserving the active type filter and query. */
export function contextHref(
  basePath: string,
  type?: string,
  q?: string,
): string {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
