// Pure filter/count/sort logic for doc card lists (specs, ADRs); Views own only useState wiring.

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
  cards: T[],
  statusOf: (card: T) => SpecStatusInfo | undefined,
  filter: SpecStatusFilter,
  { query, textOf }: DocSearch<T> = {},
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

/** Sort by path (input order) or status (lifecycle order). */
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
