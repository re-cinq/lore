import styles from "./LogFormatToggle.module.css";

/** Raw/Formatted segmented control for the log viewers. Stateless (DDAU). */
export default function LogFormatToggle({
  raw,
  onChange,
}: {
  raw: boolean;
  onChange: (raw: boolean) => void;
}) {
  return (
    <span className={styles.group}>
      <button
        type="button"
        className={styles.option}
        aria-pressed={!raw}
        onClick={() => onChange(false)}
      >
        Formatted
      </button>
      <button
        type="button"
        className={styles.option}
        aria-pressed={raw}
        onClick={() => onChange(true)}
      >
        Raw
      </button>
    </span>
  );
}
