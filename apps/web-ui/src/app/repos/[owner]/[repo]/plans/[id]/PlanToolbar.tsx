import type { RefObject } from "react";
import Link from "next/link";
import type { PlanMeta } from "@re-cinq/planning-document";
import ActionMenu from "@/components/ActionMenu";
import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import Icon from "@/components/Icon";
import { storyField } from "@/lib/plan-input";
import type { PlanPageState } from "@/lib/plan-page-state";
import { canRegenerate } from "@/lib/plan-run-phase";
import { useScrolledPast } from "@/lib/use-scrolled-past";
import PlanStatusBadge from "../PlanStatusBadge";
import { planRunSummary, planRunTone, type PlanRun } from "./PlanRunCard";
import styles from "./PlanToolbar.module.scss";

type Outcome = Promise<{ error?: string }>;

export interface StoryInput {
  value: string;
  onChange: (text: string) => void;
}

interface PlanToolbarProps {
  meta: PlanMeta;
  run: PlanRun | null;
  state: PlanPageState;
  /** Attached to the bar so the page can keep the editor's outline below it. */
  barRef?: RefObject<HTMLDivElement | null>;
  /** The user story typed for a run that carries none; without it the toolbar offers no field. */
  story?: StoryInput;
  /** A fresh planning run, offered while the plan is being written. */
  draftAgain: () => Outcome;
  deletePlan: () => Outcome;
}

const REGENERATE = {
  title: "Regenerate the plan?",
  body: "This starts a new planning run. The agent drafts the plan again and can replace what its sections say.",
  confirmLabel: "Regenerate",
  tone: "danger",
} as const;

/** The plan page's one bar of controls, pinned to the window's top: what the plan is, what its run is doing, and what can be done to it. It names the plan once the plan's own heading has scrolled away. */
export default function PlanToolbar(props: PlanToolbarProps) {
  const { meta, run, story, barRef } = props;
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
        <PlanFacts meta={meta} run={run} />
        {!run?.issueUrl && story && <StoryField repo={meta.repo} {...story} />}
        <ToolbarActions {...props} />
      </div>
    </>
  );
}

function ToolbarActions(props: PlanToolbarProps) {
  const { meta, run, state, draftAgain, deletePlan } = props;

  return (
    <div className={styles.actions}>
      <RunSummary run={run} state={state} />
      {run && <RunLink run={run} />}
      {offersRegenerate(run, state) && (
        <RegeneratePlan draftAgain={draftAgain} />
      )}
      <ActionMenu label="More plan actions">
        <ConfirmedActionButton
          action={deletePlan}
          label="Delete plan"
          question={deleteQuestion(meta.title)}
        />
      </ActionMenu>
    </div>
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

function PlanFacts({ meta, run }: Pick<PlanToolbarProps, "meta" | "run">) {
  return (
    <p className="meta">
      {meta.type} plan · version {meta.version} · by {meta.createdBy}
      {meta.approval &&
        ` · approved by ${meta.approval.approvedBy} on ${approvedOn(meta.approval.approvedAt)}`}
      {run?.issueUrl && <UserStoryLink run={run} />}
    </p>
  );
}

function UserStoryLink({ run }: { run: PlanRun }) {
  return (
    <>
      {" · "}
      <a
        href={run.issueUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
      >
        User story{run.issueNumber === null ? "" : ` #${run.issueNumber}`}
        <Icon name="external" size={14} inline />
      </a>
    </>
  );
}

const STORY_HINT_ID = "plan-story-hint";

// A run's start items are fixed, so a story typed here reaches the next run the page starts, never the one already going.
function StoryField({ repo, value, onChange }: StoryInput & { repo: string }) {
  return (
    <div className={styles.storyField}>
      <label>
        User story
        <input
          value={value}
          placeholder="An issue URL, or its number: 123"
          aria-describedby={STORY_HINT_ID}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <span id={STORY_HINT_ID} className="meta">
        {storyHint(value, repo)}
      </span>
    </div>
  );
}

function storyHint(value: string, repo: string): string {
  const named = storyField(value, repo);

  return "error" in named
    ? named.error
    : "Applies from the next draft or refine.";
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
