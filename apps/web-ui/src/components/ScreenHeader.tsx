import type { ReactNode } from "react";
import styles from "./ScreenHeader.module.scss";

interface ScreenHeaderProps {
  /** The sidebar group the screen sits in, printed as a `{group}` label. */
  group: string;
  title: string;
  lede?: ReactNode;
  /** Anything that belongs to the title block, such as the tab row under it. */
  children?: ReactNode;
}

/** A screen's title block: its sidebar group, its name and one line on what it holds. */
export default function ScreenHeader(props: ScreenHeaderProps) {
  const { group, title, lede, children } = props;

  return (
    <header className={styles.header}>
      <span className={styles.group}>{`{${group}}`}</span>
      <h1 className={styles.title}>{title}</h1>
      {lede && <p className={styles.lede}>{lede}</p>}
      {children}
    </header>
  );
}
