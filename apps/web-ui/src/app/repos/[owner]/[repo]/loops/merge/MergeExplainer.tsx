import styles from "../LoopExplainer.module.scss";

const INSTALL_URL = "https://github.com/apps/lore-reviewer/installations/new";

/** What the auto-merge loop does, and what it needs before it can be switched on. */
export default function MergeExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      While the loop is on, a pull request Lore opened that passes Lore&apos;s
      review is approved by the lore-reviewer App and GitHub&apos;s auto-merge
      is armed on it; GitHub merges it once the branch rule is met. Lore never
      merges itself. Switching it on needs the{" "}
      <a href={INSTALL_URL}>lore-reviewer App installed</a>, a branch rule on
      the default branch that requires one approval, review from code owners and
      the CI checks, and the two-key approval: a pull request labelled{" "}
      <code>dark-factory-approval</code> and approved by a code owner of{" "}
      <code>CLAUDE.md</code>. Switching it off takes back the auto-merge Lore
      armed.
    </p>
  );
}
