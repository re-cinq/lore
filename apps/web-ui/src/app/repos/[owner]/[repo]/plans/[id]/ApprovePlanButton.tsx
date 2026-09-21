"use client";

import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { PlanActions } from "./plan-actions";

interface ApprovePlanButtonProps {
  canApprove: boolean;
  approve: PlanActions["approve"];
}

const APPROVE = {
  title: "Approve the plan?",
  body: "The planning agent writes the specs from this plan and opens a spec PR for review.",
  confirmLabel: "Approve",
  tone: "accent",
} as const;

/** Approval ends the plan, so it is asked first; lore-api validates it again, so the enabled state is only a courtesy. */
export default function ApprovePlanButton({
  canApprove,
  approve,
}: ApprovePlanButtonProps) {
  return (
    <ConfirmedActionButton
      action={approve}
      label="Approve plan"
      question={APPROVE}
      waitingOn={
        canApprove ? undefined : "The outline lists what the plan still needs"
      }
    />
  );
}
