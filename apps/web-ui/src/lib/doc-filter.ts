// Pure filter/count/sort logic shared by every doc card list (per-repo specs,
// per-repo ADRs, the global browsers). Views own only the useState wiring;
// the counts feed SpecStatusChips and `visible` is what renders.

import {
  matchesSpecStatusFilter,
  SPEC_STATUS_ORDER,
  type SpecStatus,
  type SpecStatusFilter,
  type SpecStatusInfo,
} from "./spec-status";

export type DocSortOrder = "path" | "status";

export interface DocFilterResult<T> {
  counts: Partial<Record<SpecStatus, number>>;
  visible: T[];
}

/** Free-text narrowing: the typed query and how to read an item's searchable text. */
export interface DocSearch<T> {
  query?: string;
  textOf?: (item: T) => string;
}

export function filterDocCards<T>(
  items: T[],
  statusOf: (item: T) => SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
  { query, textOf }: DocSearch<T> = {},
): DocFilterResult<T> {
  const needle = query?.trim().toLowerCase() ?? "";
  const matched =
    needle && textOf
      ? items.filter((item) => textOf(item).toLowerCase().includes(needle))
      : items;
  const counts: Partial<Record<SpecStatus, number>> = {};

  for (const item of matched) {
    const info = statusOf(item);

    if (info) {
      counts[info.status] = (counts[info.status] ?? 0) + 1;
    }
  }

  return {
    counts,
    visible: matched.filter((item) =>
      matchesSpecStatusFilter(statusOf(item), filter),
    ),
  };
}

/** `path` keeps the input order (lists arrive path-sorted); `status` stable-sorts
 *  by lifecycle order (draft → … → retired), unstatused items last. */
export function sortDocCards<T>(
  items: T[],
  order: DocSortOrder,
  statusOf: (item: T) => SpecStatusInfo | undefined,
): T[] {
  if (order === "path") {
    return items;
  }
  const rank = (item: T): number => {
    const info = statusOf(item);

    return info
      ? SPEC_STATUS_ORDER.indexOf(info.status)
      : SPEC_STATUS_ORDER.length;
  };

  return [...items].sort((a, b) => rank(a) - rank(b));
}
