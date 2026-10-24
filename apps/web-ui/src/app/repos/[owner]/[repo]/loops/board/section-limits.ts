// How many rows each section of the Loops tab shows: every row of Current, and a page of the others at a time, held in the address bar so a live refresh keeps it. Pure.

/** The sections shown a page at a time; Current always shows every row. */
export const LIMITED_SECTIONS = [
  "backlog",
  "parked",
  "awaiting_merge",
  "recent",
] as const;

export type LimitedSection = (typeof LIMITED_SECTIONS)[number];

export type SectionLimits = Record<LimitedSection, number>;

/** Rows a section shows at first, and how many more each "Load more" adds. */
export const ROWS_PER_PAGE = 5;

/** The most rows the address bar may ask a section for; lore-api refuses more. */
const MAX_ROWS = 200;

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Each limited section's count from the address bar (`?recent=10`), or a page of rows where it names none or names one out of range. */
export function sectionLimitsOf(params: SearchParams): SectionLimits {
  return Object.fromEntries(
    LIMITED_SECTIONS.map((key) => [key, countOf(params[key])]),
  ) as SectionLimits;
}

function countOf(value: string | string[] | undefined): number {
  const count = Number(Array.isArray(value) ? value[0] : value);

  return Number.isInteger(count) && count >= 1 && count <= MAX_ROWS
    ? count
    : ROWS_PER_PAGE;
}

export function isLimited(key: string): key is LimitedSection {
  return (LIMITED_SECTIONS as readonly string[]).includes(key);
}

/** The rows a section shows, and whether it holds more: lore-api answers one row beyond the count, so a row past it means there is more to load. */
export function shownRows<Row>(
  key: string,
  rows: readonly Row[],
  limits: SectionLimits,
): { rows: Row[]; hasMore: boolean } {
  if (!isLimited(key)) {
    return { rows: [...rows], hasMore: false };
  }
  const limit = limits[key];

  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** The address of the same view with one more page of the section, every other parameter kept. */
export function loadMoreHref(
  base: string,
  params: SearchParams,
  key: LimitedSection,
): string {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(params)) {
    if (typeof value === "string" && name !== key) {
      query.set(name, value);
    }
  }
  query.set(key, String(sectionLimitsOf(params)[key] + ROWS_PER_PAGE));

  return `${base}?${query.toString()}`;
}

/** What the board pages by: each section's row count, and the address that loads one more page of a section. */
export interface Paging {
  limits: SectionLimits;
  loadMore(key: string): string;
}

/** The paging of the view at `base` with the address bar's parameters. */
export function pagingOf(base: string, params: SearchParams): Paging {
  return {
    limits: sectionLimitsOf(params),
    loadMore: (key) =>
      isLimited(key) ? loadMoreHref(base, params, key) : base,
  };
}
