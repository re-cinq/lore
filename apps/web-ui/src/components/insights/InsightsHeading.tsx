import type { ReactNode } from "react";
import styles from "./insights.module.css";

interface InsightsHeadingProps {
  title: string;
  lede?: ReactNode;
  /** Controls set beside the title, such as a window picker. */
  actions?: ReactNode;
}

/** The page title of every Insights page: the `{insights}` section caption, the title and an optional lede. */
export function InsightsHeading({
  title,
  lede,
  actions,
}: InsightsHeadingProps) {
  return (
    <header className={styles.heading}>
      <div className={styles.headingText}>
        <p className={styles.eyebrow}>{"{insights}"}</p>
        <h1 className={styles.title}>{title}</h1>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
      </div>
      {actions}
    </header>
  );
}
