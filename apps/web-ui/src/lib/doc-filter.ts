// Pure filter/count/sort logic shared by every doc card list (per-repo specs,
// per-repo ADRs, the global browsers). Views own only the useState wiring;
// the counts feed SpecStatusChips and `visible` is what renders.

import {
  matchesSpecStatusFilter,
  SPEC_STATUS_ORDER,
  type SpecStatus,
  type SpecStatusFilter,
} from "./spec-status";

export type DocSortOrder = "path" | "status";

export interface DocFilterResult<T> {
  counts: Partial<Record<SpecStatus, number>>;
  visible: T[];
}

export function filterDocCards<T>(
  items: T[],
  statusOf: (item: T) => SpecStatus | undefined,
  filter: SpecStatusFilter,
  query?: string,
  textOf?: (item: T) => string,
): DocFilterResult<T> {
  const needle = query?.trim().toLowerCase() ?? "";
  const matched =
    needle && textOf
      ? items.filter((item) => textOf(item).toLowerCase().includes(needle))
      : items;
  const counts: Partial<Record<SpecStatus, number>> = {};

  for (const item of matched) {
    const status = statusOf(item);

    if (status) {
      counts[status] = (counts[status] ?? 0) + 1;
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
  statusOf: (item: T) => SpecStatus | undefined,
): T[] {
  if (order === "path") {
    return items;
  }
  const rank = (item: T): number => {
    const status = statusOf(item);

    return status
      ? SPEC_STATUS_ORDER.indexOf(status)
      : SPEC_STATUS_ORDER.length;
  };

  return [...items].sort((a, b) => rank(a) - rank(b));
}
