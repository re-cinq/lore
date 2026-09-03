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

export function filterDocCards<T>(
  cards: T[],
  statusOf: (card: T) => SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
  query?: string,
  textOf?: (card: T) => string,
): DocFilterResult<T> {
  const needle = query?.trim().toLowerCase() ?? "";
  const matched =
    needle && textOf
      ? cards.filter((card) => textOf(card).toLowerCase().includes(needle))
      : cards;
  const counts: Partial<Record<SpecStatus, number>> = {};

  for (const card of matched) {
    const status = statusOf(card);

    if (status) {
      counts[status.status] = (counts[status.status] ?? 0) + 1;
    }
  }

  return {
    counts,
    visible: matched.filter((card) =>
      matchesSpecStatusFilter(statusOf(card), filter),
    ),
  };
}

/** `path` keeps the input order (lists arrive path-sorted); `status` stable-sorts
 *  by lifecycle order (draft → … → retired), unstatused items last. */
export function sortDocCards<T>(
  cards: T[],
  order: DocSortOrder,
  statusOf: (card: T) => SpecStatusInfo | undefined,
): T[] {
  if (order === "path") {
    return cards;
  }
  const rank = (card: T): number => {
    const status = statusOf(card);

    return status
      ? SPEC_STATUS_ORDER.indexOf(status.status)
      : SPEC_STATUS_ORDER.length;
  };

  return [...cards].sort((a, b) => rank(a) - rank(b));
}
