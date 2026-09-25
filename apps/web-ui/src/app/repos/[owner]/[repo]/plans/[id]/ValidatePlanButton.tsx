"use client";

import { FormError } from "@/components/FormError";
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
      <button
        type="button"
        className="btn-secondary"
        disabled={pending || !!waitingOn}
        title={waitingOn}
        onClick={run}
      >
        Validate the plan
      </button>
      <FormError message={error} />
    </>
  );
}
