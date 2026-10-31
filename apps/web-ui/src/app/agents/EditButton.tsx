"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** A card's Edit: the navigation runs in a transition, so the button stays busy until the edit page is shown and a second click cannot start another. */
export default function EditButton({ href }: { href: string }) {
  const router = useRouter();
  // eslint-disable-next-line no-restricted-syntax -- a navigation, not an action: router.push returns at once, so PendingActionButton would drop its pending state before the edit page is shown; the transition's isPending lasts until it is.
  const [pending, startTransition] = useTransition();

  return (
    <EditButtonView
      pending={pending}
      onEdit={() => startTransition(() => router.push(href))}
    />
  );
}

/** The button itself, pure so the pending look can be shown without a navigation in flight. */
export function EditButtonView({
  pending,
  onEdit,
}: {
  pending: boolean;
  onEdit: () => void;
}) {
  return (
    <button type="button" onClick={onEdit} disabled={pending} aria-busy={pending}>
      Edit
      {pending && (
        <span className="chip-spinner" role="status" aria-label="Loading" />
      )}
    </button>
  );
}
