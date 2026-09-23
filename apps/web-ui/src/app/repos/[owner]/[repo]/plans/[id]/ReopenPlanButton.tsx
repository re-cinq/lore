"use client";

import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { PlanPageState } from "@/lib/plan-page-state";
import type { PlanActions } from "./plan-actions";

/** What reopening does from each state that offers it; a state absent here offers no Reopen. */
export const REOPEN_BODY: Partial<Record<PlanPageState, string>> = {
  "spec-pr-open":
    "The spec PR goes back to the author and the plan opens for writing. Approve it again to update the same PR.",
  question:
    "The plan opens for writing so you can answer the question. Approve it again to continue the spec work.",
  "spec-work-failed":
    "The plan opens for writing. Approve it again to start a fresh spec pass.",
  delivered:
    "The plan opens for writing. Approving it again opens a NEW spec PR that revises the merged specs.",
};

interface ReopenPlanButtonProps {
  state: PlanPageState;
  reopen: PlanActions["reopen"];
}

/** Reopen plan, asked first with what follows from this state; nothing for a state that cannot be reopened. */
export default function ReopenPlanButton({
  state,
  reopen,
}: ReopenPlanButtonProps) {
  const body = REOPEN_BODY[state];

  return body ? (
    <ConfirmedActionButton
      action={reopen}
      label="Reopen plan"
      question={reopenQuestion(body)}
    />
  ) : null;
}

function reopenQuestion(body: string) {
  return {
    title: "Reopen the plan?",
    body,
    confirmLabel: "Reopen",
    tone: "danger",
  } as const;
}
