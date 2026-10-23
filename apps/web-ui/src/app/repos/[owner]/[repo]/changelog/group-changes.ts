import type { ChangelogChange } from "@/lib/api/changelog";

export interface PersonChanges {
  person: string;
  changes: ChangelogChange[];
}

export const UNASSIGNED = "unassigned";

/** A pull request under its author, an issue under each of its assignees, people sorted by name; a change with nobody goes under `unassigned`. */
export function groupByPerson(changes: ChangelogChange[]): PersonChanges[] {
  const byPerson = changes.reduce((acc, change) => {
    const people = change.people.length > 0 ? change.people : [UNASSIGNED];

    people.forEach((person) =>
      acc.set(person, [...(acc.get(person) ?? []), change]),
    );

    return acc;
  }, new Map<string, ChangelogChange[]>());

  return [...byPerson.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([person, grouped]) => ({ person, changes: grouped }));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** `Week 43 · 19 Oct – 25 Oct`: Monday to Sunday, the week's `to` being the next Monday. */
export function weekTitle({
  weekKey,
  from,
  to,
}: {
  weekKey: string;
  from: string;
  to: string;
}): string {
  const [, number] = weekKey.split("-W");
  const sunday = new Date(Date.parse(to) - DAY_MS);

  return `Week ${Number(number)} · ${DAY_MONTH.format(new Date(from))} – ${DAY_MONTH.format(sunday)}`;
}
