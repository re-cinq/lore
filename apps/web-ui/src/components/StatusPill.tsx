// One tone→color map for every card header and attempt row instead of a copy per view.
import styles from "./StatusPill.module.scss";

export type StatusTone = "ok" | "warn" | "err" | "running" | "waiting" | "idle";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: styles.ok,
  warn: styles.warn,
  err: styles.err,
  running: styles.running,
  waiting: styles.waiting,
  idle: styles.idle,
};

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}) {
  return <span className={`${styles.pill} ${TONE_CLASS[tone]}`}>{label}</span>;
}
