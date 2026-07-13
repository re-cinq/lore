"use client";

import Link, { useLinkStatus } from "next/link";
import type { CSSProperties } from "react";

/**
 * Label for a nav link with a pending state. While the link's navigation is in
 * flight (server component still fetching), it shows a spinner and a `pending`
 * class so the clicked item highlights immediately instead of looking dead for
 * the seconds the page takes to load. Presentational + pure on `pending` so it
 * is unit-testable without the Link runtime.
 */
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

/** Reads the pending state of its ancestor Link (Next's useLinkStatus). */
function NavLabelLive({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <NavLabel label={label} pending={pending} />;
}

export default function NavLink({
  href,
  label,
  active,
  className,
  style,
}: {
  href: string;
  label: string;
  active: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = [className, active ? "active" : ""].filter(Boolean).join(" ");
  return (
    <Link
      href={href}
      className={classes}
      style={style}
      aria-current={active ? "page" : undefined}
    >
      <NavLabelLive label={label} />
    </Link>
  );
}
