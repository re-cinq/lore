import type { ReactNode } from "react";
import styles from "./insights.module.css";

interface InsightsCardProps {
  title: string;
  /** Muted note on the right of the title: the window, a budget, a count. */
  caption?: ReactNode;
  /** True when the body is rows or a table running edge to edge. */
  flush?: boolean;
  children: ReactNode;
}

/** One titled card. The title is the section's h2, so a page's outline survives the card styling. */
export function InsightsCard({
  title,
  caption,
  flush = false,
  children,
}: InsightsCardProps) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={flush ? styles.cardHeadRule : styles.cardHead}>
        <h2 className={styles.cardTitle}>{title}</h2>
        {caption ? <span className={styles.caption}>{caption}</span> : null}
      </div>
      <div className={flush ? styles.cardFlush : styles.cardBody}>
        {children}
      </div>
    </section>
  );
}
