import type { RefObject } from "react";
import Link from "next/link";
import type { PlanMeta } from "@re-cinq/planning-document";
import ActionMenu from "@/components/ActionMenu";
import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import type { PlanStory } from "@/lib/api/plans";
import type { PlanPageState } from "@/lib/plan-page-state";
import { canRegenerate } from "@/lib/plan-run-phase";
import { useScrolledPast } from "@/lib/use-scrolled-past";
import PlanStatusBadge from "../PlanStatusBadge";
import { planRunSummary, planRunTone, type PlanRun } from "./PlanRunCard";
import PlanStoryMenuItem from "./PlanStoryMenuItem";
import styles from "./PlanToolbar.module.scss";

type Outcome = Promise<{ error?: string }>;

interface PlanToolbarProps {
  meta: PlanMeta;
  run: PlanRun | null;
  state: PlanPageState;
  /** Attached to the bar so the page can keep the editor's outline below it. */
  barRef?: RefObject<HTMLDivElement | null>;
  /** The plan's user story; the actions menu's popup changes it. */
  story: PlanStory | null;
  /** A fresh planning run, offered while the plan is being written. */
  draftAgain: () => Outcome;
  deletePlan: () => Outcome;
  /** Links the plan to the issue the text names. */
  saveStory: (text: string) => Outcome;
  removeStory: () => Outcome;
}

const REGENERATE = {
  title: "Regenerate the plan?",
  body: "This starts a new planning run. The agent drafts the plan again and can replace what its sections say.",
  confirmLabel: "Regenerate",
  tone: "danger",
} as const;

/** The plan page's one bar of controls, pinned to the window's top: what the plan is, what its run is doing, and what can be done to it. It names the plan once the plan's own heading has scrolled away. */
export default function PlanToolbar(props: PlanToolbarProps) {
  const { meta, barRef } = props;
  const { sentinelRef, scrolled } = useScrolledPast<HTMLDivElement>();

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" />
      <div
        ref={barRef}
        className={styles.toolbar}
        data-scrolled={scrolled ? "" : undefined}
      >
        <PlanStatusBadge status={meta.status} />
        <strong className={styles.title}>{meta.title}</strong>
        <PlanFacts meta={meta} />
        <ToolbarActions {...props} />
      </div>
    </>
  );
}

function ToolbarActions(props: PlanToolbarProps) {
  const { run, state, draftAgain } = props;

  return (
    <div className={styles.actions}>
      <RunSummary run={run} state={state} />
      {run && <RunLink run={run} />}
      {offersRegenerate(run, state) && (
        <RegeneratePlan draftAgain={draftAgain} />
      )}
      <PlanActionMenu {...props} />
    </div>
  );
}

function PlanActionMenu({ meta, story, ...props }: PlanToolbarProps) {
  return (
    <ActionMenu label="More plan actions">
      <PlanStoryMenuItem
        repo={meta.repo}
        story={story}
        save={props.saveStory}
        remove={props.removeStory}
      />
      <ConfirmedActionButton
        action={props.deletePlan}
        label="Delete plan"
        question={deleteQuestion(meta.title)}
      />
    </ActionMenu>
  );
}

// A failure is the warning's to say, above the editor.
function RunSummary({ run, state }: Pick<PlanToolbarProps, "run" | "state">) {
  return planRunTone(run, state) === "failed" ? null : (
    <span className="meta">{planRunSummary(run, state)}</span>
  );
}

function offersRegenerate(run: PlanRun | null, state: PlanPageState): boolean {
  return state === "writing" && (!run || canRegenerate(run, run.nodes));
}

function PlanFacts({ meta }: Pick<PlanToolbarProps, "meta">) {
  return (
    <p className="meta">
      {meta.type} plan · version {meta.version} · by {meta.createdBy}
      {meta.approval &&
        ` · approved by ${meta.approval.approvedBy} on ${approvedOn(meta.approval.approvedAt)}`}
    </p>
  );
}

// The spec PR is the outline's section, not the run line's: one place says what it is to the plan's people.
function RunLink({ run }: { run: PlanRun }) {
  return (
    <Link className={styles.openRun} href={`/assembly-runs/${run.id}`}>
      Open the run →
    </Link>
  );
}

function RegeneratePlan({ draftAgain }: { draftAgain: () => Outcome }) {
  return (
    <ConfirmedActionButton
      action={draftAgain}
      label="Regenerate plan"
      question={REGENERATE}
      buttonClassName="btn-secondary"
    />
  );
}

function deleteQuestion(title: string) {
  return {
    title: "Delete the plan?",
    body: `${title} is removed for good, with every version of it. This cannot be undone.`,
    confirmLabel: "Delete",
    tone: "danger",
    typeToConfirm: title,
  } as const;
}

function approvedOn(iso: string): string {
  const when = new Date(iso);

  return Number.isNaN(when.getTime()) ? iso : when.toLocaleDateString();
}
