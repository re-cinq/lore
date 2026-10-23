import styles from "../LoopExplainer.module.scss";

/** How a ticket enters the implementation loop and what it does with it. Kept beside the board because the priority label IS the whole opt-in, and a reader looking at an empty backlog needs to know that before anything appears. */
export default function ImplementationExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      Label an open issue with exactly one of <code>priority:high</code>,{" "}
      <code>priority:medium</code>, or <code>priority:low</code> to queue it —
      the label is the whole opt-in. While the loop is enabled it picks the
      highest-priority ticket (oldest first on ties), implements it test-first,
      opens a pull request, and waits until that PR is green with every review
      thread resolved before picking the next. It never merges — a human does
      that, whenever they like. A ticket that gets stuck is labelled{" "}
      <code>lore:blocked</code> with a comment saying why; remove the label to
      re-queue it. A ticket linked as blocked by an issue that is still open
      waits instead: it gets no label, and the loop picks it up once its last
      blocker closes. An issue carrying two priority labels is skipped until a
      human settles the ambiguity.
    </p>
  );
}
