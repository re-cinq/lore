import Link from "next/link";
import type {
  ChangelogChange,
  ChangelogPage,
  ChangelogWeek,
} from "@/lib/api/changelog";
import { groupByPerson, weekTitle } from "./group-changes";
import styles from "./ChangelogView.module.scss";

/** One list per week, or one list per person inside each week. */
export type Grouping = "list" | "person";

interface ChangelogViewProps {
  base: string;
  page: ChangelogPage;
  grouping: Grouping;
  /** The page's own `before`, kept when the grouping is switched. */
  before?: string;
}

/** The repository's weeks newest first, each opening with what it delivered (specs/repo-changelog FR6). */
export default function ChangelogView(props: ChangelogViewProps) {
  const { base, page, grouping, before } = props;

  return (
    <div>
      <GroupingSwitch base={base} grouping={grouping} before={before} />
      {page.weeks.map((week) => (
        <WeekSection key={week.weekKey} week={week} grouping={grouping} />
      ))}
      {page.next && (
        <div className={styles.older}>
          <Link href={hrefOf(base, { before: page.next, grouping })}>
            Older weeks
          </Link>
        </div>
      )}
    </div>
  );
}

/** "By person" with an On/Off pill like a loop's switch: green with a dot when the week is grouped by person. A link, not a form: the grouping lives in the URL. */
function GroupingSwitch(props: {
  base: string;
  grouping: Grouping;
  before?: string;
}) {
  const on = props.grouping === "person";
  const next: Grouping = on ? "list" : "person";

  return (
    <div className={styles.toolbar}>
      <span id="by-person-label">By person</span>
      <SwitchLink
        href={hrefOf(props.base, { before: props.before, grouping: next })}
        on={on}
      />
    </div>
  );
}

function SwitchLink({ href, on }: { href: string; on: boolean }) {
  return (
    <Link
      href={href}
      role="switch"
      aria-checked={on}
      aria-labelledby="by-person-label"
      className={`${styles.switch} ${on ? styles.on : styles.off}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      {on ? "On" : "Off"}
    </Link>
  );
}

function hrefOf(
  base: string,
  { before, grouping }: { before?: string; grouping: Grouping },
): string {
  const query = new URLSearchParams({
    ...(before ? { before } : {}),
    ...(grouping === "person" ? { by: "person" } : {}),
  }).toString();

  return query ? `${base}?${query}` : base;
}

function WeekSection({
  week,
  grouping,
}: {
  week: ChangelogWeek;
  grouping: Grouping;
}) {
  return (
    <section className={styles.week} aria-label={weekTitle(week)}>
      <h3 className={styles.title}>
        {weekTitle(week)}
        {week.current && <span className={styles.current}>this week</span>}
      </h3>
      <WeekIntro week={week} />
      <WeekChanges changes={week.changes} grouping={grouping} />
    </section>
  );
}

function WeekChanges({
  changes,
  grouping,
}: {
  changes: ChangelogChange[];
  grouping: Grouping;
}) {
  return grouping === "person" ? (
    <PeopleLists changes={changes} />
  ) : (
    <ChangeList changes={changes} metaOf={numberAndPeople} />
  );
}

function WeekIntro({ week }: { week: ChangelogWeek }) {
  if (week.intro) {
    return <p className={styles.intro}>{week.intro}</p>;
  }

  return <p className={styles.note}>{missingIntro(week)}</p>;
}

function missingIntro(week: ChangelogWeek): string {
  if (week.changes.length === 0) {
    return "Nothing merged or closed this week.";
  }

  return week.current
    ? "No introduction yet: it is written when the week ends."
    : "No introduction was written for this week.";
}

function PeopleLists({ changes }: { changes: ChangelogChange[] }) {
  return groupByPerson(changes).map(({ person, changes: owned }) => (
    <div key={person}>
      <h4 className={styles.person}>{person}</h4>
      <ChangeList changes={owned} metaOf={numberOnly} />
    </div>
  ));
}

function numberOnly(change: ChangelogChange): string {
  return `#${change.number}${change.kind === "issue" ? " (issue)" : ""}`;
}

function numberAndPeople(change: ChangelogChange): string {
  const people = change.people.join(", ");

  return people ? `${numberOnly(change)} · ${people}` : numberOnly(change);
}

function ChangeList(props: {
  changes: ChangelogChange[];
  metaOf: (change: ChangelogChange) => string;
}) {
  if (props.changes.length === 0) {
    return null;
  }

  return (
    <ul className={styles.changes}>
      {props.changes.map((change) => (
        <li key={`${change.kind}-${change.number}`}>
          <a href={change.url}>{change.title}</a>{" "}
          <span className={styles.meta}>{props.metaOf(change)}</span>
        </li>
      ))}
    </ul>
  );
}
