import type { ReactNode } from "react";

// Controls stay `children` since confirmation flows differ per caller; `description` is a string, not ReactNode, since it renders inside a <p>.
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
