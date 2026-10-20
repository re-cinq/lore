import {
  footerDestinations,
  navGroups,
  type NavDestination,
} from "@/components/shell/nav-groups";

/** One row of the palette: where it goes, and the mono group caption beside it. */
export interface PaletteItem {
  key: string;
  group: string;
  label: string;
  href: string;
}

/** Every nav destination, in sidebar order, then the footer's. */
export function allDestinations(): PaletteItem[] {
  const grouped = navGroups.flatMap((g) =>
    g.links.map((link) => destinationEntry(g.label.toLowerCase(), link)),
  );

  return [
    ...grouped,
    ...footerDestinations.map((l) => destinationEntry("app", l)),
  ];
}

function destinationEntry(group: string, link: NavDestination): PaletteItem {
  return { key: link.href, group, label: link.label, href: link.href };
}

/** The destinations whose label holds the query, then a full-text search for it; an empty query lists every destination. */
export function paletteItems(query: string): PaletteItem[] {
  const q = query.trim();
  const needle = q.toLowerCase();
  const matches = allDestinations().filter((destination) =>
    labelHolds(destination, needle),
  );

  if (!q) {
    return matches;
  }

  return [...matches, searchEntry(q)];
}

function labelHolds(destination: PaletteItem, needle: string): boolean {
  const label = destination.label.toLowerCase();

  return label.includes(needle);
}

function searchEntry(q: string): PaletteItem {
  return {
    key: "search-query",
    group: "search",
    label: `Search for “${q}”`,
    href: `/search?q=${encodeURIComponent(q)}`,
  };
}

/** Arrow keys walk the list and wrap at either end, so the last entry is one press from the first. */
export function moveSelection(
  selected: number,
  delta: number,
  count: number,
): number {
  if (count === 0) {
    return 0;
  }

  return (((selected + delta) % count) + count) % count;
}
