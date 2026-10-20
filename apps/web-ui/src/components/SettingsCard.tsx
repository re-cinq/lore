import type { ReactNode } from "react";
import styles from "./SettingsCard.module.css";

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
    <div className={styles.head}>
      <div className={styles.titles}>
        <Heading id={`${id}-title`} className={styles.title}>
          {title}
        </Heading>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {action}
    </div>
  );
}
