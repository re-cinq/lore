import Link from "next/link";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
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
