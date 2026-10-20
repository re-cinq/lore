import type { ReactNode } from "react";
import styles from "./SettingsLayout.module.css";

export interface SettingsNavItem {
  /** The id of the card the link jumps to. */
  id: string;
  label: string;
  danger?: boolean;
}

export interface SettingsLayoutProps {
  nav: SettingsNavItem[];
  children: ReactNode;
}

/** A settings page: an anchor sub-navigation beside a column of section cards. */
export default function SettingsLayout({ nav, children }: SettingsLayoutProps) {
  return (
    <div className={styles.layout}>
      <SettingsNav sections={nav} />
      <div className={styles.content}>{children}</div>
    </div>
  );
}

function SettingsNav({ sections }: { sections: SettingsNavItem[] }) {
  return (
    <nav aria-label="Settings sections" className={styles.nav}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className={`${styles.navLink}${section.danger ? ` ${styles.navDanger}` : ""}`}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
