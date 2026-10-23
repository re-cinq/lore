import styles from "../LoopExplainer.module.scss";

/** What the spec upkeep loop does each week. */
export default function UpkeepExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      Every Monday at 10:00 UTC, while the loop is on, Lore reads the
      repository&apos;s specs against the traceability graph: statements whose
      code changed since they were written, and testable statements with no test
      link. An agent fixes both in one pull request and fixes its CI until it is
      green, then asks for review. A repository with an upkeep pull request
      still open gets no second one until it is merged or closed.
    </p>
  );
}
