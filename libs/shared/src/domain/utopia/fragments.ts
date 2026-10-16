// The parts a statement item is built from, and the halving that keeps every item under Utopia's push limits.

import {
  fitsOneItem,
  type Entity,
  type Statement,
  type StatementItem,
} from "./statements.js";

export interface Fragment {
  e: Entity[];
  s: Statement[];
}

export type Unnamed = Omit<StatementItem, "externalId">;

export const MAX_TEXT_CHARS = 4000;

/** Words Utopia searches and cites: every run of whitespace collapsed to one space, cut past MAX_TEXT_CHARS so one text never pushes its item past the limits. */
export function cutText(text: string): string {
  const words = text.replace(/\s+/g, " ").trim();

  return words.length > MAX_TEXT_CHARS
    ? `${words.slice(0, MAX_TEXT_CHARS)}…`
    : words;
}

/** Entities once each by name, in first-seen order, so a test two links name twice appears once in `e`. */
export function joinFragments(head: Fragment, parts: Fragment[]): Unnamed {
  const byName = new Map<string, Entity>();

  for (const entity of [head, ...parts].flatMap((fragment) => fragment.e)) {
    byName.set(entity[0], byName.get(entity[0]) ?? entity);
  }

  return {
    e: [...byName.values()],
    s: [...head.s, ...parts.flatMap((fragment) => fragment.s)],
  };
}

/** Halves the parts until every item is under the push limits; the first item keeps the plain id and the rest take `.2`, `.3`, so an unsplit item's id never changes. */
export function splitToFit<T>(
  externalId: string,
  parts: T[],
  build: (parts: T[]) => Unnamed,
): StatementItem[] {
  return fittingGroups(parts, build).map((group, index) => ({
    externalId: index === 0 ? externalId : `${externalId}.${index + 1}`,
    ...build(group),
  }));
}

function fittingGroups<T>(parts: T[], build: (parts: T[]) => Unnamed): T[][] {
  if (parts.length <= 1 || fitsOneItem({ externalId: "", ...build(parts) })) {
    return [parts];
  }
  const half = Math.ceil(parts.length / 2);

  return [
    ...fittingGroups(parts.slice(0, half), build),
    ...fittingGroups(parts.slice(half), build),
  ];
}
