import type { ReactNode } from "react";

/**
 * A framed section for an irreversible action: what it is, what it costs, and the
 * controls that do it.
 *
 * Extracted from the feature detail view, which composed `"spec-card danger-zone"`
 * by hand and depended on three selectors in globals.css. There is exactly ONE call
 * site today — the win is not present reuse but that the class pairing and the
 * styling coupling now live in one place, so the next destructive action has an
 * obvious home rather than a string to copy.
 *
 * The controls are `children` on purpose: confirmation flows differ (a two-step
 * confirm here, a typed repo name elsewhere), and baking one in would make the
 * second caller fight it.
 */
export function DangerZone({
  title = "Danger zone",
  description,
  children,
}: {
  title?: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="spec-card danger-zone">
      <h3>{title}</h3>
      <p className="meta">{description}</p>
      {children}
    </div>
  );
}
