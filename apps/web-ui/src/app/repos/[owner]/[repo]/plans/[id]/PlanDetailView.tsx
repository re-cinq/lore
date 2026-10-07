import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import ConfirmedActionButton from "@/components/ConfirmedActionButton";
import Icon from "@/components/Icon";
import { planPageState, type PlanPageState } from "@/lib/plan-page-state";
import { storyField } from "@/lib/plan-input";
import type { PlanUser } from "@/lib/plan-user";
import DraftingPlan from "./DraftingPlan";
import PlanStatusBadge from "../PlanStatusBadge";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";
import PlanRunFollower from "./PlanRunFollower";
import PlanWorkspace from "./PlanWorkspace";
import type { PlanActions } from "./plan-actions";
import styles from "./PlanDetailView.module.scss";

interface PlanDetailViewProps extends PlanActions {
  meta: PlanMeta;
  run: PlanRun | null;
  user: PlanUser | null;
  draftAgain: () => Promise<{ error?: string }>;
  deletePlan: () => Promise<{ error?: string }>;
  /** The user story typed for a run that carries none; without it the header offers no field. */
  story?: StoryInput;
}

export interface StoryInput {
  value: string;
  onChange: (text: string) => void;
}

export default function PlanDetailView({
  meta,
  run,
  user,
  draftAgain,
  deletePlan,
  story,
  ...actions
}: PlanDetailViewProps) {
  const state = planPageState(meta.status, run);
  const card = { run, state, draftAgain, reopen: actions.reopen };

  return (
    <div>
      <PlanHeader meta={meta} run={run} deletePlan={deletePlan} story={story} />
      <PlanRunPanel {...card} />
      <PlanBody meta={meta} run={run} user={user} state={state} {...actions} />
    </div>
  );
}

type PlanRunPanelProps = Parameters<typeof PlanRunCard>[0];

// The run card, and behind it the follower that re-reads the page whenever the run's line moves.
function PlanRunPanel(props: PlanRunPanelProps) {
  const { run } = props;

  return (
    <>
      {run && (
        <PlanRunFollower runId={run.id} live={OPEN_RUN.has(run.status)} />
      )}
      <PlanRunCard {...props} />
    </>
  );
}

type PlanBodyProps = Omit<
  PlanDetailViewProps,
  "draftAgain" | "deletePlan" | "story"
> & {
  state: PlanPageState;
};

// The draft being written would replace anything typed into it, so the editor waits for it.
function PlanBody({ meta, run, user, state, ...actions }: PlanBodyProps) {
  if (state === "drafting") {
    return <DraftingPlan />;
  }

  if (!user) {
    return <Alert variant="secondary">Sign in to open this plan.</Alert>;
  }

  return (
    <PlanWorkspace
      meta={meta}
      user={user}
      state={state}
      {...specPrOf(run)}
      {...actions}
    />
  );
}

const OPEN_RUN: ReadonlySet<string> = new Set(["queued", "running"]);

const NO_PR: Pick<
  PlanRun,
  "prUrl" | "prNumber" | "prTitle" | "prUnresolvedThreads"
> = {
  prUrl: null,
  prNumber: null,
  prTitle: null,
  prUnresolvedThreads: null,
};

function specPrOf(run: PlanRun | null): typeof NO_PR {
  const { prUrl, prNumber, prTitle, prUnresolvedThreads } = run ?? NO_PR;

  return { prUrl, prNumber, prTitle, prUnresolvedThreads };
}

type PlanHeaderProps = Pick<
  PlanDetailViewProps,
  "meta" | "run" | "deletePlan" | "story"
>;

function PlanHeader({ meta, run, deletePlan, story }: PlanHeaderProps) {
  return (
    <div className={styles.header}>
      <div>
        <PlanFacts meta={meta} run={run} />
        {!run?.issueUrl && story && <StoryField repo={meta.repo} {...story} />}
      </div>
      <div className={styles.headerActions}>
        <PlanStatusBadge status={meta.status} />
        <ConfirmedActionButton
          action={deletePlan}
          label="Delete plan"
          question={deleteQuestion(meta.title)}
        />
      </div>
    </div>
  );
}

function PlanFacts({ meta, run }: Pick<PlanHeaderProps, "meta" | "run">) {
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
