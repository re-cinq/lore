"use client";

import { FormError } from "@/components/FormError";
import PendingActionButton from "@/components/PendingActionButton";
import { useRefreshingAction } from "@/components/useRefreshingAction";
import type { PlanActions } from "./plan-actions";

interface ValidatePlanButtonProps extends Pick<PlanActions, "validate"> {
  /** Why validation must wait, e.g. the validator is already reading the plan. */
  waitingOn?: string;
}

/** Runs the outline's validation again ahead of approval; nothing to confirm, since it changes nothing. */
export default function ValidatePlanButton({
  validate,
  waitingOn,
}: ValidatePlanButtonProps) {
  const { error, pending, run } = useRefreshingAction(validate);

  return (
    <>
      <PendingActionButton
        action={run}
        text="Validate the plan"
        pendingText="Validating…"
        pending={pending}
        disabled={!!waitingOn}
        title={waitingOn}
        className="btn-secondary"
      />
      <FormError message={error} />
    </>
  );
}
