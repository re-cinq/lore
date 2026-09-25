"use client";

import { FormError } from "@/components/FormError";
import { useRefreshingAction } from "@/components/useRefreshingAction";
import type { PlanActions } from "./plan-actions";

/** Runs the outline's validation again ahead of approval; nothing to confirm, since it changes nothing. */
export default function ValidatePlanButton({
  validate,
}: Pick<PlanActions, "validate">) {
  const { error, pending, run } = useRefreshingAction(validate);

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={run}
      >
        Validate the plan
      </button>
      <FormError message={error} />
    </>
  );
}
