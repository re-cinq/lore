"use client";

import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { PlanPageState } from "@/lib/plan-page-state";
import ApprovePlanButton from "./ApprovePlanButton";
import type { PlanActions } from "./plan-actions";
import styles from "./PlanOutlineActions.module.scss";

interface PlanOutlineActionsProps extends Pick<
  PlanActions,
  "approve" | "reopen" | "retrySpecWork"
> {
  state: PlanPageState;
  /** The outline's validation verdict; approval waits on it. */
  canApprove: boolean;
  prUrl: string | null;
  prNumber: number | null;
}

const STILL_REFINING = "The planning agent is still refining a section";

const REOPEN_BODY: Partial<Record<PlanPageState, string>> = {
  "spec-pr-open":
    "The spec PR goes back to the author and the plan opens for writing. Approve it again to update the same PR.",
  question:
    "The plan opens for writing so you can answer the question. Approve it again to continue the spec work.",
  "spec-work-failed":
    "The plan opens for writing. Approve it again to start a fresh spec pass.",
  delivered:
    "The plan opens for writing. Approving it again opens a NEW spec PR that revises the merged specs.",
};

const RETRY = {
  title: "Retry the spec work?",
  body: "A fresh spec pass starts from the approved plan: it analyses which specs change, writes them and opens the spec PR.",
  confirmLabel: "Retry",
  tone: "accent",
} as const;

/** The action the plan's state calls for, drawn under the outline: approve while writing, reopen or retry once approved, and the spec PR wherever one exists. */
export default function PlanOutlineActions(props: PlanOutlineActionsProps) {
  const { prUrl, prNumber } = props;

  return (
    <div className={styles.actions}>
      {prUrl && (
        <a className={styles.pr} href={prUrl}>
          Spec PR #{prNumber}
        </a>
      )}
      <StateAction {...props} />
    </div>
  );
}

function StateAction(props: PlanOutlineActionsProps) {
  const { state, canApprove, approve, prNumber } = props;

  if (state === "writing" || state === "reopened" || state === "refining") {
    return (
      <ApprovePlanButton
        canApprove={canApprove}
        approve={approve}
        waitingOn={state === "refining" ? STILL_REFINING : undefined}
        updatesPr={state === "reopened" ? prNumber : null}
      />
    );
  }

  return <ApprovedActions {...props} />;
}

function ApprovedActions({
  state,
  reopen,
  retrySpecWork,
}: PlanOutlineActionsProps) {
  const reopenBody = REOPEN_BODY[state];

  return (
    <>
      {state === "spec-work-failed" && (
        <ConfirmedActionButton
          action={retrySpecWork}
          label="Retry the spec work"
          question={RETRY}
        />
      )}
      {reopenBody && <ReopenPlan reopen={reopen} body={reopenBody} />}
    </>
  );
}

function ReopenPlan({
  reopen,
  body,
}: Pick<PlanActions, "reopen"> & { body: string }) {
  return (
    <ConfirmedActionButton
      action={reopen}
      label="Reopen plan"
      question={{
        title: "Reopen the plan?",
        body,
        confirmLabel: "Reopen",
        tone: "danger",
      }}
    />
  );
}
