import styles from "../LoopExplainer.module.scss";

/** What the daily digest posts, and where its schedule is set. */
export default function DigestExplainer() {
  return (
    <p className={`meta ${styles.howTo}`}>
      While the loop is on, Lore posts what moved on the repository to its Slack
      channel: what each person did and what each does next, under an opening
      line an agent writes. The time, the days, the timezone and the sections
      are set on the repository&apos;s Settings page, and repositories that
      share a channel share one post.
    </p>
  );
}
