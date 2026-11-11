"use client";

import Link, { useLinkStatus } from "next/link";
import Icon from "@/components/Icon";
import type { IconName } from "@/lib/icon-map";

interface NavLinkProps {
  href: string;
  label: string;
  active: boolean;
  className?: string;
  /** Drawn before the label; the label stays the link's accessible name. */
  icon?: IconName;
  /** Count shown beside the label when positive (e.g. open inbox items). */
  badge?: number;
}

export default function NavLink(props: NavLinkProps) {
  const { href, label, active, className, icon, badge } = props;
  const classes = [className, active ? "active" : ""].filter(Boolean).join(" ");

  return (
    <Link
      href={href}
      className={classes}
      aria-current={active ? "page" : undefined}
    >
      {icon && <Icon name={icon} size={18} />}
      <NavLabelLive label={label} />
      <NavBadge badge={badge} />
    </Link>
  );
}

function NavBadge({ badge }: { badge?: number }) {
  if (badge === undefined || badge <= 0) {
    return null;
  }

  return (
    <span className="nav-badge" aria-label={`${badge} open items`}>
      {badge}
    </span>
  );
}

/** Reads the pending state of its ancestor Link (Next's useLinkStatus). */
function NavLabelLive({ label }: { label: string }) {
  const { pending } = useLinkStatus();

  return <NavLabel label={label} pending={pending} />;
}

/** Pure on `pending` (not the Link runtime) so it highlights immediately during navigation instead of looking dead, and is unit-testable standalone. */
export function NavLabel({
  label,
  pending,
}: {
  label: string;
  pending: boolean;
}) {
  return (
    <span className={pending ? "nav-label pending" : "nav-label"}>
      {label}
      {pending && (
        <span className="nav-spinner" role="status" aria-label="loading" />
      )}
    </span>
  );
}
