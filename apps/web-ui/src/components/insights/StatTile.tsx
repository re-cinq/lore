import type { ReactNode } from "react";
import styles from "./insights.module.css";

export type StatDot = "ok" | "bad" | "warn" | "run";

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** The headline tile of a row, set on the primary color. */
  hero?: boolean;
  /** A status dot before the label. */
  dot?: StatDot;
  /** Class for the figure, for a caller whose figure carries its own tone. */
  valueClass?: string;
  children?: ReactNode;
}

const DOTS: Record<StatDot, string> = {
  ok: styles.dotOk,
  bad: styles.dotBad,
  warn: styles.dotWarn,
  run: styles.dotRun,
};

/** One headline figure with its label, and any notes under it. */
export function StatTile(props: StatTileProps) {
  const { label, value, hero = false, dot, valueClass, children } = props;

  return (
    <div className={hero ? styles.tileHero : styles.tile}>
      <span className={styles.tileLabel}>
        {dot ? <span className={`${styles.dot} ${DOTS[dot]}`} /> : null}
        {label}
      </span>
      <span className={`${styles.tileValue} ${valueClass ?? ""}`}>{value}</span>
      {children}
    </div>
  );
}

/** A responsive row of tiles. The title is an h2 for the outline, read out but not shown: the tiles speak for themselves. */
export function StatTiles({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className={styles.srOnly}>{title}</h2>
      <div className={styles.tiles}>{children}</div>
    </section>
  );
}
