"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// `disabled` is read out of props (not spread) since the spread once landed after `disabled={pending}` and silently un-disabled the button; `pending` overrides `useFormStatus`, which reports pending only for a submit made through the form.
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
