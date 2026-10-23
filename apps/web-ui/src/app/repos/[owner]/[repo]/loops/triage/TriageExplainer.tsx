import styles from "../LoopExplainer.module.scss";

/** What the issue-triage loop does with an issue, said beside its board. */
export default function TriageExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      Label an issue <code>triage: needs-triage</code> (or{" "}
      <code>lore:triage</code>) and, while the loop is on, a run reproduces it,
      diagnoses it, and either closes it as obsolete, splits it, or labels it{" "}
      <code>triage: needs-priority</code> for a person to rank. An issue triage
      cannot finish waits under Parked with the label that says why; answering
      it puts it back in the backlog.
    </p>
  );
}
