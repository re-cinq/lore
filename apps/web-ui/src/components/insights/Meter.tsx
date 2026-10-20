import styles from "./insights.module.css";

export type MeterTone = "ok" | "bad" | "accent";

interface MeterProps {
  /** Share of the track filled, 0 to 1; clamped. */
  fraction: number;
  tone?: MeterTone;
}

const TONES: Record<MeterTone, string> = {
  ok: styles.meterOk,
  bad: styles.meterBad,
  accent: styles.meterAccent,
};

/** A thin horizontal bar. Decorative: the figure it stands for is always printed beside it. */
export function Meter({ fraction, tone = "accent" }: MeterProps) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;

  return (
    <span className={styles.meterTrack} aria-hidden="true">
      <span
        className={`${styles.meterFill} ${TONES[tone]}`}
        style={{ ["--meter-fill" as string]: `${pct}%` }}
      />
    </span>
  );
}
