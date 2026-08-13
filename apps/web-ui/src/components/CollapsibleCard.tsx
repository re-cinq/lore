// A `spec-card` you can fold away.
//
// Built on native <details> rather than React state, for three reasons: it needs no
// client boundary, the browser handles the keyboard and ARIA semantics correctly, and
// a closed <details> keeps its content in the DOM — so find-in-page and screen readers
// still reach a collapsed spec, which conditionally rendering the children would break.
//
// The same idiom is already used for the failure block's "Your input for this round".

import type { ReactNode } from "react";

export default function CollapsibleCard({
  title,
  hint,
  defaultOpen = false,
  className = "",
  children,
}: {
  title: string;
  /** Shown beside the title, for saying how much is folded away without opening it. */
  hint?: string;
  /** Long documents default to CLOSED: the point of folding them is that they were
   *  taking the page over. Callers whose content IS the point pass this. */
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`spec-card ${className}`.trim()}
      style={{ marginBottom: 12 }}
    >
      <details open={defaultOpen}>
        <summary
          style={{
            cursor: "pointer",
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <strong>{title}</strong>
          {hint ? <span className="meta">{hint}</span> : null}
        </summary>
        <div style={{ marginTop: 10 }}>{children}</div>
      </details>
    </div>
  );
}
