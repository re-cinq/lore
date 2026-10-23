import styles from "./StateDot.module.scss";

/** A loop's switch state as a colour: green on, red off. Decorative; the text beside it says the same. */
export default function StateDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`${styles.dot} ${enabled ? styles.on : styles.off}`}
      data-testid="state-dot"
      data-enabled={enabled}
      aria-hidden="true"
    />
  );
}
