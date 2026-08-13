import type { ReactNode } from "react";

// Controls stay `children` because confirmation flows differ — a two-step confirm
// here, a typed name elsewhere — and baking one in would make the second caller
// fight it. `description` is a string, not ReactNode: it renders inside a <p>, and
// block-level children there are invalid HTML.
export function DangerZone({
  title = "Danger zone",
  description,
  children,
}: {
  title?: string;
  description: string;
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
