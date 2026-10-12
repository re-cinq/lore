"use client";

import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { PlanActions } from "./plan-actions";

interface ApprovePlanButtonProps {
  canApprove: boolean;
  approve: PlanActions["approve"];
  /** Why approval must wait beyond the outline, e.g. the agent is mid-pass. */
  waitingOn?: string;
  /** The spec PR a re-approval updates, once one is open. */
  updatesPr?: number | null;
}

const OUTLINE_WAITS = "The outline lists what the plan still needs";

/** Approval ends the plan, so it is asked first; lore-api validates it again, so the enabled state is only a courtesy. */
export default function ApprovePlanButton({
  canApprove,
  approve,
  waitingOn,
  updatesPr,
}: ApprovePlanButtonProps) {
  return (
    <ConfirmedActionButton
      action={approve}
      label="Approve plan"
      question={approveQuestion(updatesPr)}
      waitingOn={waitingOn ?? (canApprove ? undefined : OUTLINE_WAITS)}
    />
  );
}

function approveQuestion(updatesPr: number | null | undefined) {
  return {
    title: "Approve the plan?",
    body: updatesPr
      ? `The planning agent writes the specs from this plan again and updates spec PR #${updatesPr}.`
      : "The planning agent writes the specs from this plan and opens a spec PR for review.",
    confirmLabel: "Approve",
    tone: "accent",
  } as const;
}
