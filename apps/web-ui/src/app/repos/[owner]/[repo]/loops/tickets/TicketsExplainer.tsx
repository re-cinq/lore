import styles from "../LoopExplainer.module.scss";

/** What the spec tickets loop does on every merged spec. */
export default function TicketsExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      While the loop is on, every pull request that merges a{" "}
      <code>specs/&lt;name&gt;/spec.md</code> into the default branch starts a
      run for that spec: an agent splits it into a user story and task issues,
      keeping the tasks an earlier merge filed and closing the ones the spec
      dropped, and a check counts the testable statements no task names. The
      implementation loop picks the task issues up from there. A spec marked
      Shipped, Rejected or Retired, and a merge that only moved test links,
      start nothing.
    </p>
  );
}
