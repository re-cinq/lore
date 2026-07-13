import Link from "next/link";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {description && <p className="meta">{description}</p>}
      {action && (
        <p>
          <Link href={action.href}>{action.label}</Link>
        </p>
      )}
    </div>
  );
}
