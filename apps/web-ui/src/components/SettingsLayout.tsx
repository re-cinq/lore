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

export interface SettingsCardProps {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  /** A control beside the title, such as a link or a copy button. */
  action?: ReactNode;
  danger?: boolean;
  /** h2 on a page of its own, h3 under a tab whose title is already the h2. */
  headingLevel?: 2 | 3;
  children?: ReactNode;
}

/** One section of a settings page, the target of a sub-navigation link. */
export function SettingsCard(props: SettingsCardProps) {
  const { id, danger, children } = props;

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`${styles.card}${danger ? ` ${styles.danger}` : ""}`}
    >
      <SettingsCardHead {...props} />
      {children}
    </section>
  );
}

function SettingsCardHead(props: SettingsCardProps) {
  const { id, title, description, action, headingLevel = 2 } = props;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div className={styles.cardHead}>
      <div className={styles.cardTitles}>
        <Heading id={`${id}-title`} className={styles.cardTitle}>
          {title}
        </Heading>
        {description && <p className={styles.cardDescription}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

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

export interface SettingsSwitchProps {
  name: string;
  label: ReactNode;
  detail?: ReactNode;
  defaultChecked: boolean;
  /** What the form posts when on; the browser's "on" when omitted. */
  value?: string;
}

/** A boolean setting drawn as a switch: a real checkbox, so the form posts it unchanged. */
export function SettingsSwitch(props: SettingsSwitchProps) {
  const { name, label, detail, defaultChecked, value } = props;

  return (
    <label className={styles.switchRow}>
      <span className={styles.switchText}>
        <span className={styles.switchLabel}>{label}</span>
        {detail && <span className={styles.switchDetail}>{detail}</span>}
      </span>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className={styles.switch}
      />
    </label>
  );
}
