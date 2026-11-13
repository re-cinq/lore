"use client";

import { useState, type RefObject } from "react";
import type { PlanMeta } from "@re-cinq/planning-document";
import type { RefineFailure } from "@re-cinq/planning-editor";
import { Alert } from "@/components/Alert";
import { planPageState, type PlanPageState } from "@/lib/plan-page-state";
import type { PlanUser } from "@/lib/plan-user";
import { useElementHeight } from "@/lib/use-element-height";
import DraftingPlan from "./DraftingPlan";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";
import PlanRunNotice from "./PlanRunNotice";
import PlanToolbar, { type StoryInput } from "./PlanToolbar";
import { usePlanRunLive } from "./usePlanRunLive";
import PlanWorkspace from "./PlanWorkspace";
import type { PlanActions } from "./plan-actions";

interface PlanDetailViewProps extends PlanActions {
  meta: PlanMeta;
  run: PlanRun | null;
  user: PlanUser | null;
  draftAgain: () => Promise<{ error?: string }>;
  deletePlan: () => Promise<{ error?: string }>;
  /** The user story typed for a run that carries none; without it the toolbar offers no field. */
  story?: StoryInput;
}

// Everything below reads the live `run`, folded from the socket, never the seed the server rendered once — no router.refresh().
export default function PlanDetailView(props: PlanDetailViewProps) {
  const { ref: barRef, height: barHeight } = useElementHeight<HTMLDivElement>();

  return (
    <div style={{ ["--plan-toolbar-height" as string]: `${barHeight}px` }}>
      <PlanDetailContent {...props} barRef={barRef} />
    </div>
  );
}

function PlanDetailContent({
  run: seed,
  draftAgain,
  deletePlan,
  story,
  barRef,
  ...below
}: PlanDetailViewProps & { barRef: RefObject<HTMLDivElement | null> }) {
  const run = usePlanRunLive(seed, below.refreshRunFacts);
  const state = planPageState(below.meta.status, run);

  return (
    <>
      <PlanToolbar
        {...{ run, state, barRef, story, draftAgain, deletePlan }}
        meta={below.meta}
      />
      <PlanBelowToolbar {...below} run={run} state={state} />
    </>
  );
}

type PlanBelowToolbarProps = Omit<
  PlanDetailViewProps,
  "draftAgain" | "deletePlan" | "story"
> & { state: PlanPageState };

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

type PlanBodyProps = Omit<
  PlanDetailViewProps,
  "draftAgain" | "deletePlan" | "story"
> & {
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
