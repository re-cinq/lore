import type { ChangelogChange } from "@/lib/api/changelog";
import { groupByPerson } from "./group-changes";
import styles from "./ChangelogView.module.scss";

/** One list per week or release, or one list per person inside each. */
export type Grouping = "list" | "person";

/** A list of changes, or one list per person. */
export default function Changes({
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
