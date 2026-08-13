"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// One button for "an action is in flight", whichever React idiom produced the
// boolean. `useFormStatus` covers a plain form submit; `pending` is the override for
// a caller driving its own `useTransition` or `useActionState`, which is why seven
// copies of `disabled={pending}` had accumulated in the features vertical.
//
// `disabled` is read out of the props rather than spread, because the spread used to
// land AFTER `disabled={pending}` — so a caller passing `disabled` silently
// un-disabled the button for the whole submit.
//
// One limit worth knowing: `useFormStatus` reports pending only for a submit made
// THROUGH the form. A caller invoking `formAction(fd)` inside its own
// `startTransition` sees false and must pass the override.
export function SubmitButton({
  children,
  pendingLabel,
  pending,
  disabled,
  ...props
}: {
  children: ReactNode;
  pendingLabel?: string;
  /** Overrides the form status for a caller that owns the boolean itself. */
  pending?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const status = useFormStatus();
  const busy = pending ?? status.pending;

  return (
    <button
      type="submit"
      {...props}
      disabled={busy || disabled}
      aria-busy={busy}
    >
      {busy && pendingLabel ? pendingLabel : children}
    </button>
  );
}
