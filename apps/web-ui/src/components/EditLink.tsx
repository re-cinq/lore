"use client";

import Link, { useLinkStatus } from "next/link";

/** An agent's Edit: a link whose label shows a spinner from the click until the edit page is shown, so a slow page never reads as a missed click. */
export default function EditLink({ href, className }: { href: string; className?: string }) {
  return (
    <Link href={href} className={className}>
      <EditLabel />
    </Link>
  );
}

// useLinkStatus answers only inside the Link it reports on.
function EditLabel() {
  const { pending } = useLinkStatus();

  return (
    <span aria-busy={pending} data-pending={pending || undefined}>
      Edit
      {pending && <span className="chip-spinner" role="status" aria-label="Loading" />}
    </span>
  );
}
