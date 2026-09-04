// Native <details>, not React state: no client boundary, browser handles ARIA, and closed content stays in the DOM for find-in-page/screen readers.

import type { ReactNode } from "react";
import { StatusPill, type StatusTone } from "./StatusPill";
import styles from "./CollapsibleCard.module.scss";

function hasVisibleContent(children: ReactNode): boolean {
  return children !== null && children !== undefined && children !== false;
}

function CardSummary({
  title,
  status,
  labels,
  hint,
  actions,
}: {
  title: string;
  status?: { label: string; tone: StatusTone };
  labels?: (string | null | undefined)[];
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <summary className={styles.summary}>
      <strong>{title}</strong>
      {status ? <StatusPill label={status.label} tone={status.tone} /> : null}
      {labels
        ?.filter((label): label is string => Boolean(label))
        .map((label) => (
          <span key={label} className="meta">
            {label}
          </span>
        ))}
      {hint ? <span className="meta">{hint}</span> : null}
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </summary>
  );
}

function CardBody({
  hasContent,
  emptyState,
  children,
}: {
  hasContent: boolean;
  emptyState?: string;
  children?: ReactNode;
}) {
  if (hasContent) {
    return <>{children}</>;
  }

  return emptyState ? <>{emptyState}</> : null;
}

export default function CollapsibleCard({
  title,
  status,
  labels,
  hint,
  defaultOpen = false,
  emptyState,
  actions,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  /** A toned outcome pill rendered right after the title — string data only. */
  status?: { label: string; tone: StatusTone };
  /** Plain-text header tags rendered as muted spans; empty entries are dropped, so callers pass optional values unfiltered. */
  labels?: (string | null | undefined)[];
  /** Shown beside the title, for saying how much is folded away without opening it. */
  hint?: string;
  /** Defaults to CLOSED — long documents were taking the page over; callers whose content IS the point pass this. */
  defaultOpen?: boolean;
  /** The note shown when the card has no content, so every empty card says it the same way. */
  emptyState?: string;
  /** Interactive header content; must preventDefault on click or it also toggles the fold — a <summary> treats any click as its own. */
  actions?: ReactNode;
  /** Reports the fold state on every toggle, for callers that fetch lazily on first open. */
  onToggle?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  const hasContent = hasVisibleContent(children);

  return (
    <div className={`spec-card ${className}`.trim()}>
      <details
        open={defaultOpen}
        onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      >
        <CardSummary
          title={title}
          status={status}
          labels={labels}
          hint={hint}
          actions={actions}
        />
        <div className={styles.body}>
          <CardBody hasContent={hasContent} emptyState={emptyState}>
            {children}
          </CardBody>
        </div>
      </details>
    </div>
  );
}
