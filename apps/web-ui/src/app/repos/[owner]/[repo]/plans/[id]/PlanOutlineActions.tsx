"use client";

import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { PlanPageState } from "@/lib/plan-page-state";
import ApprovePlanButton from "./ApprovePlanButton";
import ReopenPlanButton from "./ReopenPlanButton";
import type { PlanActions } from "./plan-actions";
import styles from "./PlanOutlineActions.module.scss";

interface PlanOutlineActionsProps extends Pick<
  PlanActions,
  "approve" | "reopen" | "retrySpecWork" | "reworkSpecs"
> {
  state: PlanPageState;
  /** The outline's validation verdict; approval waits on it. */
  canApprove: boolean;
  prUrl: string | null;
  prNumber: number | null;
  /** The PR's title as GitHub reports it; null names the PR by its number. */
  prTitle: string | null;
  /** Review threads on the PR nobody resolved yet; null when GitHub could not be asked. */
  prUnresolvedThreads: number | null;
}

const APPROVABLE: ReadonlySet<PlanPageState> = new Set([
  "writing",
  "reopened",
  "refining",
  "answering",
]);

const STILL_REFINING = "The planning agent is still refining a section";

const RETRY = {
  title: "Retry the spec work?",
  body: "A fresh spec pass starts from the approved plan: it analyses which specs change, writes them and opens the spec PR.",
  confirmLabel: "Retry",
  tone: "accent",
} as const;

const REWORK = {
  title: "Rework the specs from the review?",
  body: "The spec writer reads the PR's unresolved review comments, amends the specs on the same branch, and sends anything that contradicts the plan back to the plan as questions for its people.",
  confirmLabel: "Rework",
  tone: "accent",
} as const;

// What the spec PR is to the plan's people right now, worded as the section's title.
const SPEC_PR_TITLES: Partial<Record<PlanPageState, string>> = {
  "spec-pr-open": "Spec waiting for review",
  reopened: "Spec PR updated on the next approval",
  delivering: "Spec merged",
  delivered: "Spec merged",
};

/** The action the plan's state calls for, drawn under the outline: approve while writing, reopen or retry once approved, and the spec PR wherever one exists. */
export default function PlanOutlineActions(props: PlanOutlineActionsProps) {
  return (
    <div className={styles.actions}>
      <SpecPr {...props} />
      <StateAction {...props} />
    </div>
  );
}

// The PR as a section of its own: a title that says what it waits for, then the PR by name, opened in a new tab so the plan stays where it is, how many review threads still wait on someone, and the rework while it waits.
function SpecPr(props: PlanOutlineActionsProps) {
  const { state, prUrl, prNumber, prTitle, prUnresolvedThreads } = props;

  if (!prUrl) {
    return null;
  }
  const unresolved = unresolvedThreadsText(state, prUnresolvedThreads);

  return (
    <section className={styles.specPr} aria-labelledby="spec-pr-title">
      <p id="spec-pr-title" className="meta">
        {SPEC_PR_TITLES[state] ?? "Spec PR"}
      </p>
      <SpecPrLink href={prUrl} prNumber={prNumber} prTitle={prTitle} />
      {unresolved && <p className="meta">{unresolved}</p>}
      <ReworkSpecs state={state} reworkSpecs={props.reworkSpecs} />
    </section>
  );
}

// Only a PR waiting for review has a review to rework from; a merged or revised one does not.
function ReworkSpecs({
  state,
  reworkSpecs,
}: Pick<PlanOutlineActionsProps, "state" | "reworkSpecs">) {
  if (state !== "spec-pr-open") {
    return null;
  }

  return (
    <ConfirmedActionButton
      action={reworkSpecs}
      label="Rework the specs from the review"
      question={REWORK}
    />
  );
}

type SpecPrLinkProps = Pick<PlanOutlineActionsProps, "prNumber" | "prTitle"> & {
  href: string;
};

function SpecPrLink({ href, prNumber, prTitle }: SpecPrLinkProps) {
  return (
    <a
      className={styles.pr}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {prTitle ?? `Spec PR #${prNumber}`}
    </a>
  );
}

// A clean PR is worth saying only while it waits for review; a merged one with nothing open says nothing.
function unresolvedThreadsText(
  state: PlanPageState,
  count: number | null,
): string | null {
  if (count === null) {
    return null;
  }

  if (count === 0) {
    return state === "spec-pr-open" ? "No unresolved comments" : null;
  }

  return count === 1 ? "1 unresolved comment" : `${count} unresolved comments`;
}

function StateAction(props: PlanOutlineActionsProps) {
  const { state, canApprove, approve, prNumber } = props;

  if (APPROVABLE.has(state)) {
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
  return (
    <>
      {state === "spec-work-failed" && (
        <ConfirmedActionButton
          action={retrySpecWork}
          label="Retry the spec work"
          question={RETRY}
        />
      )}
      <ReopenPlanButton state={state} reopen={reopen} />
    </>
  );
}
