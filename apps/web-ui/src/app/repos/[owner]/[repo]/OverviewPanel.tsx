import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./RepoOverviewView.module.css";

interface PanelProps {
  title: string;
  link?: { href: string; text: string };
  /** Names the section by its heading, for a page that lists several. */
  headingId?: string;
  className?: string;
  children: ReactNode;
}

/** A titled card with an optional link at the right of its head. The repo's sub-pages draw their sections with it too, so every tab speaks the same card language. */
export default function OverviewPanel(props: PanelProps) {
  return (
    <section
      className={`${styles.panel} ${props.className ?? ""}`}
      aria-labelledby={props.headingId}
    >
      <PanelHead {...props} />
      {props.children}
    </section>
  );
}

function PanelHead({ title, link, headingId }: PanelProps) {
  return (
    <div className={styles.panelHead}>
      <h2 id={headingId} className={styles.panelTitle}>
        {title}
      </h2>
      {link && (
        <Link href={link.href} className={styles.panelLink}>
          {link.text}
        </Link>
      )}
    </div>
  );
}

/** A table that runs edge to edge inside a panel, scrolling sideways on a narrow screen rather than the page. */
export function PanelTable({ children }: { children: ReactNode }) {
  return <div className={styles.tableWrap}>{children}</div>;
}
