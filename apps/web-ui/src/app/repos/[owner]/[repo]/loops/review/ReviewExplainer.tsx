import styles from "../LoopExplainer.module.scss";

/** What the code-review loop does with a pull request, said beside its board. */
export default function ReviewExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      While the loop is on, every pull request is reviewed when it opens and
      re-checked on every push; a request for changes from a trusted reviewer is
      answered on the pull request. A draft is skipped until it is marked ready.{" "}
      <code>@lore review</code> on a pull request asks for a review whatever the
      switch says.
    </p>
  );
}
