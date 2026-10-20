import type { ReactNode } from "react";
import styles from "./SettingsHeader.module.css";

export interface SettingsHeaderProps {
  /** The small mono caption above the title, written `{like this}`. */
  eyebrow: string;
  title: string;
  lede?: ReactNode;
}

/** The page title block: caption, gradient title, and an optional lede. */
export function SettingsHeader({ eyebrow, title, lede }: SettingsHeaderProps) {
  return (
    <header className={styles.header}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.title}>{title}</h1>
      {lede && <p className={styles.lede}>{lede}</p>}
    </header>
  );
}
