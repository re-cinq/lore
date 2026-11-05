// The parts a statement item is built from, and the halving that keeps every item under Utopia's push limits.

import {
  MAX_ITEM_BYTES,
  MAX_STATEMENTS_PER_ITEM,
  fitsOneItem,
  itemBytes,
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

/** Entities once each by Utopia's name key and statements once each, in first-seen order, so a test two links name twice, or two tests one title names, appears once. */
export function joinFragments(head: Fragment, parts: Fragment[]): Unnamed {
  const fragments = [head, ...parts];

  return {
    e: firstOfEach(
      fragments.flatMap((fragment) => fragment.e),
      ([name]) => nameKey(name),
    ),
    s: firstOfEach(
      fragments.flatMap((fragment) => fragment.s),
      (statement) => JSON.stringify(statement),
    ),
  };
}

/** Utopia's `name_key`: it answers 422 for a whole item listing two entities with one key, and folds a statement's subject onto the listed entity the same way. */
function nameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function firstOfEach<T>(values: T[], keyOf: (value: T) => string): T[] {
  const byKey = new Map<string, T>();

  for (const value of values) {
    byKey.set(keyOf(value), byKey.get(keyOf(value)) ?? value);
  }

  return [...byKey.values()];
}

/** Packs the parts in order into as few items as stay under the push limits: the first item keeps the plain id and the rest take `.2`, `.3`, so an unsplit item's id never changes. A part too big for any item travels alone. */
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

/** One pass over the parts, each measured once: a part joins the open group while the running total stays under the limits, otherwise it opens the next group. The total counts every part in full, an upper bound since joining drops repeats, and a group that still does not fit once built is halved. */
function fittingGroups<T>(parts: T[], build: (parts: T[]) => Unnamed): T[][] {
  const head = sizeOf(build([]));
  const groups: T[][] = [];
  let open: Sized<T> = { parts: [], size: head };

  for (const part of parts) {
    const added = minus(sizeOf(build([part])), head);
    const grown = plus(open.size, added);

    if (open.parts.length === 0 || within(grown)) {
      open = { parts: [...open.parts, part], size: grown };
      continue;
    }
    groups.push(open.parts);
    open = { parts: [part], size: plus(head, added) };
  }

  return [...groups, open.parts].flatMap((group) => confirmed(group, build));
}

interface Size {
  statements: number;
  bytes: number;
}

interface Sized<T> {
  parts: T[];
  size: Size;
}

function sizeOf(built: Unnamed): Size {
  return {
    statements: built.s.length,
    bytes: itemBytes({ externalId: "", ...built }),
  };
}

function plus(a: Size, b: Size): Size {
  return { statements: a.statements + b.statements, bytes: a.bytes + b.bytes };
}

function minus(a: Size, b: Size): Size {
  return { statements: a.statements - b.statements, bytes: a.bytes - b.bytes };
}

function within(size: Size): boolean {
  return (
    size.statements <= MAX_STATEMENTS_PER_ITEM && size.bytes <= MAX_ITEM_BYTES
  );
}

/** The group as built, halved until each half fits; a single part too big for any item travels alone. */
function confirmed<T>(group: T[], build: (parts: T[]) => Unnamed): T[][] {
  if (group.length <= 1 || fitsOneItem({ externalId: "", ...build(group) })) {
    return [group];
  }
  const half = Math.ceil(group.length / 2);

  return [
    ...confirmed(group.slice(0, half), build),
    ...confirmed(group.slice(half), build),
  ];
}
