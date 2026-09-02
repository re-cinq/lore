// A `spec-card` you can fold away.
//
// Built on native <details> rather than React state, for three reasons: it needs no
// client boundary, the browser handles the keyboard and ARIA semantics correctly, and
// a closed <details> keeps its content in the DOM — so find-in-page and screen readers
// still reach a collapsed spec, which conditionally rendering the children would break.
//
// The same idiom is already used for the failure block's "Your input for this round".

import type { ReactNode } from "react";
import { StatusPill, type StatusTone } from "./StatusPill";
import styles from "./CollapsibleCard.module.scss";

export default function CollapsibleCard({
  title,
  status,
  labels,
  hint,
  defaultOpen = false,
  emptyState,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  /** A toned outcome pill rendered right after the title — string data only. */
  status?: { label: string; tone: StatusTone };
  /** Plain-text header tags (a node type, a category) rendered as muted spans.
   *  Empty entries are dropped here, so callers pass optional values unfiltered. */
  labels?: (string | null | undefined)[];
  /** Shown beside the title, for saying how much is folded away without opening it. */
  hint?: string;
  /** Long documents default to CLOSED: the point of folding them is that they were
   *  taking the page over. Callers whose content IS the point pass this. */
  defaultOpen?: boolean;
  /** The note shown when the card has no content — every empty card says it the
   *  same way (plain body text) instead of each caller rolling its own. */
  emptyState?: string;
  /** Reports the fold state on every toggle — for callers that fetch lazily on
   *  first open. */
  onToggle?: (open: boolean) => void;
  className?: string;
  children?: ReactNode;
}) {
  const hasContent =
    children !== null && children !== undefined && children !== false;

  return (
    <div className={`spec-card ${className}`.trim()}>
      <details
        open={defaultOpen}
        onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
      >
        <summary className={styles.summary}>
          <strong>{title}</strong>
          {status ? (
            <StatusPill label={status.label} tone={status.tone} />
          ) : null}
          {labels
            ?.filter((label): label is string => Boolean(label))
            .map((label) => (
              <span key={label} className="meta">
                {label}
              </span>
            ))}
          {hint ? <span className="meta">{hint}</span> : null}
        </summary>
        <div className={styles.body}>
          {hasContent ? children : null}
          {!hasContent && emptyState ? <>{emptyState}</> : null}
        </div>
      </details>
    </div>
  );
}
