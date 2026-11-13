"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import type { RefineFailure } from "@re-cinq/planning-editor";
import { Alert } from "@/components/Alert";
import type { PlanStory } from "@/lib/api/plans";
import { planPageState, type PlanPageState } from "@/lib/plan-page-state";
import type { PlanUser } from "@/lib/plan-user";
import { useElementHeight } from "@/lib/use-element-height";
import DraftingPlan from "./DraftingPlan";
import { PlanRunLoading } from "./PlanDetailSkeleton";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";
import PlanRunError from "./PlanRunError";
import PlanRunNotice from "./PlanRunNotice";
import PlanToolbar from "./PlanToolbar";
import type { PlanRunState } from "./usePlanRunChannel";
import PlanWorkspace, { preloadPlanEditor } from "./PlanWorkspace";
import type { PlanActions } from "./plan-actions";

interface PlanDetailViewProps extends PlanActions {
  meta: PlanMeta;
  /** The plan's run as its channel last described it; read only once `runState` is `known`. */
  run: PlanRun | null;
  runState: PlanRunState;
  /** Opens the run's channel again after it failed. */
  retryRun: () => void;
  user: PlanUser | null;
  draftAgain: () => Promise<{ error?: string }>;
  deletePlan: () => Promise<{ error?: string }>;
  /** The plan's user story: linked in the outline, changed from the actions menu. */
  story: PlanStory | null;
  saveStory: (text: string) => Promise<{ error?: string }>;
  removeStory: () => Promise<{ error?: string }>;
}

type ToolbarOnlyProps =
  "draftAgain" | "deletePlan" | "saveStory" | "removeStory";

type RunProps = "run" | "runState" | "retryRun";

// The toolbar is drawn from the plan alone, at once; what the run decides waits for the run's channel, and the editor never opens before the page knows no draft is being written (specs/plan-detail-fast-open SC-004).
export default function PlanDetailView(props: PlanDetailViewProps) {
  const { ref: barRef, height: barHeight } = useElementHeight<HTMLDivElement>();

  useEffect(preloadPlanEditor, []);

  return (
    <div style={{ ["--plan-toolbar-height" as string]: `${barHeight}px` }}>
      <PlanDetailContent {...props} barRef={barRef} />
    </div>
  );
}

// The toolbar reads the whole page's props; the parts below it take only theirs. Everything reads the run its channel folded, never a seed the server rendered once.
function PlanDetailContent({
  run,
  runState,
  retryRun,
  barRef,
  ...props
}: PlanDetailViewProps & { barRef: RefObject<HTMLDivElement | null> }) {
  const state = planPageState(props.meta.status, run);
  const runInBar = { run, state, barRef, runPending: PENDING[runState] };

  return (
    <>
      <PlanToolbar {...props} {...runInBar} />
      <RunSection runState={runState} retryRun={retryRun}>
        <PlanBelowToolbar {...belowOf(props)} run={run} state={state} />
      </RunSection>
    </>
  );
}

const PENDING: Record<PlanRunState, "loading" | "failed" | undefined> = {
  unknown: "loading",
  failed: "failed",
  known: undefined,
};

/** Skeletons while the run is unknown and an error when it could not be read: until then nothing that depends on the run is drawn, the editor least of all. */
function RunSection({
  runState,
  retryRun,
  children,
}: Pick<PlanDetailViewProps, "runState" | "retryRun"> & {
  children: ReactNode;
}) {
  if (runState === "unknown") {
    return <PlanRunLoading />;
  }

  return runState === "failed" ? <PlanRunError retry={retryRun} /> : children;
}

function belowOf({
  draftAgain: _draftAgain,
  deletePlan: _deletePlan,
  saveStory: _saveStory,
  removeStory: _removeStory,
  ...below
}: Omit<PlanDetailViewProps, RunProps>): Omit<
  PlanDetailViewProps,
  ToolbarOnlyProps | RunProps
> {
  return below;
}

type PlanBelowToolbarProps = Omit<
  PlanDetailViewProps,
  ToolbarOnlyProps | "runState" | "retryRun"
> & {
  state: PlanPageState;
};

// The editor reports which sections' refines failed; the warning above it names them.
function PlanBelowToolbar({ state, ...below }: PlanBelowToolbarProps) {
  const [refineFailures, setRefineFailures] = useState<
    readonly RefineFailure[]
  >([]);

  return (
    <>
      <PlanRunNotice
        run={below.run}
        state={state}
        refineFailures={refineFailures}
      />
      <PlanRunCard run={below.run} state={state} reopen={below.reopen} />
      <PlanBody {...below} state={state} onRefineFailures={setRefineFailures} />
    </>
  );
}

type PlanBodyProps = Omit<PlanBelowToolbarProps, "state"> & {
  state: PlanPageState;
  onRefineFailures: (failures: readonly RefineFailure[]) => void;
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
