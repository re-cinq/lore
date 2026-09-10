import type { ReactNode } from "react";
import styles from "./SpendView.module.css";

interface SpendSectionProps {
  title: string;
  /** Whether the figures below are Lore's estimate or a vendor's invoice — the distinction the page turns on, made a label rather than left to prose. */
  kind: "estimate" | "billed";
  caption?: ReactNode;
  children: ReactNode;
}

/** One labelled band of the spend page. The pill states estimate-vs-billed once, at the top of the group, so every table beneath it inherits the claim. */
export function SpendSection({
  title,
  kind,
  caption,
  children,
}: SpendSectionProps) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <KindPill kind={kind} />
      </div>
      {caption ? <p className={`meta ${styles.subnote}`}>{caption}</p> : null}
      {children}
    </section>
  );
}

function KindPill({ kind }: { kind: "estimate" | "billed" }) {
  const tone = kind === "estimate" ? "badge-blue" : "badge-gray";

  return (
    <span className={`badge ${tone} ${styles.kindPill}`}>
      {kind === "estimate" ? "estimate" : "billed"}
    </span>
  );
}
