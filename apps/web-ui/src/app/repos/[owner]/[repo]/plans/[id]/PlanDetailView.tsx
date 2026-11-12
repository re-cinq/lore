"use client";

import type { PlanMeta } from "@re-cinq/planning-document";
import { Alert } from "@/components/Alert";
import { planPageState, type PlanPageState } from "@/lib/plan-page-state";
import type { PlanUser } from "@/lib/plan-user";
import DraftingPlan from "./DraftingPlan";
import PlanRunCard, { type PlanRun } from "./PlanRunCard";
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
export default function PlanDetailView({
  meta,
  run: seed,
  user,
  draftAgain,
  deletePlan,
  story,
  ...actions
}: PlanDetailViewProps) {
  const run = usePlanRunLive(seed, actions.refreshRunFacts);
  const state = planPageState(meta.status, run);
  const toolbar = { meta, run, state, story, draftAgain, deletePlan };

  return (
    <div>
      <PlanToolbar {...toolbar} />
      <PlanRunCard run={run} state={state} reopen={actions.reopen} />
      <PlanBody meta={meta} run={run} user={user} state={state} {...actions} />
    </div>
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
