import styles from "../LoopExplainer.module.scss";

/** What the auto-merge loop does with a pull request code review has passed. */
export default function MergeExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      While the loop is on, every open pull request Lore&apos;s review approved
      is taken up, whoever opened it. When its build is red or it conflicts with
      its base, an agent fixes it; when review threads are open, the agent
      answers each and resolves the ones its commit settled. Once CI is green,
      no thread is open, Lore&apos;s review stands approved on the head and the
      pull request has been open as long as the repository&apos;s Settings page
      asks (24 hours unless changed there), Lore approves it. Where the branch
      rule asks for an approval, GitHub&apos;s auto-merge is armed and GitHub
      merges; where it asks for none, Lore merges it. A pull request that
      changes a path a code owner must approve, or one the loop could not fix in
      three rounds, is left for a person under Parked. Lore approves the pull
      requests it opened itself as the lore-reviewer App, which has to be
      installed.
    </p>
  );
}
