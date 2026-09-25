import { notFound } from "next/navigation";
import { planMetaSchema, type PlanMeta } from "@re-cinq/planning-document";
import { readPlan } from "@/lib/api/plans";
import { fetchPrStatus, type PrStatus } from "@/lib/api/pr-status";
import {
  fetchAssemblyRunNodes,
  fetchPlanRun,
  type AssemblyRun,
} from "@/lib/assembly-runs";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import PlanDetailView from "./PlanDetailView";
import type { PlanRun } from "./PlanRunCard";
import {
  approvePlanAction,
  deletePlanAction,
  draftAgainAction,
  openPlanSocketAction,
  refinePlanAction,
  reopenPlanAction,
  retrySpecWorkAction,
  reworkSpecsAction,
  validatePlanAction,
} from "./actions";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;
  const { meta, run, user } = await planPage(fullName, id);

  return (
    <PlanDetailView
      meta={meta}
      run={run}
      user={user}
      {...boundActions(fullName, id)}
    />
  );
}

// Every action bound to this plan of this repo on the server, so the client never names either.
function boundActions(fullName: string, id: string) {
  return {
    openSocket: openPlanSocketAction.bind(null, fullName, id),
    approve: approvePlanAction.bind(null, fullName, id),
    refine: refinePlanAction.bind(null, fullName, id),
    draftAgain: draftAgainAction.bind(null, fullName, id),
    reopen: reopenPlanAction.bind(null, fullName, id),
    retrySpecWork: retrySpecWorkAction.bind(null, fullName, id),
    reworkSpecs: reworkSpecsAction.bind(null, fullName, id),
    validate: validatePlanAction.bind(null, fullName, id),
    deletePlan: deletePlanAction.bind(null, fullName, id),
  };
}

// The plan, its run and who is looking — the plan first, so a plan under another repo is not found before anything else is read.
async function planPage(fullName: string, planId: string) {
  const meta = await repoPlanMeta(fullName, planId);
  const [run, session] = await Promise.all([
    planRunFor(fullName, planId),
    getSession(),
  ]);

  return { meta, run, user: planUserOf(session as PlanSession | null) };
}

// A plan is only shown under the repo it belongs to.
async function repoPlanMeta(
  fullName: string,
  planId: string,
): Promise<PlanMeta> {
  const stored = await readPlan(planId);
  const plan = stored.status === "ok" ? stored.data.json : undefined;

  if (plan?.repo !== fullName) {
    notFound();
  }

  return planMetaSchema.parse(plan);
}

// The plan's planning run with its visits, or null before one has started.
async function planRunFor(
  repo: string,
  planId: string,
): Promise<PlanRun | null> {
  const run = await fetchPlanRun(repo, planId);

  if (!run) {
    return null;
  }
  const [nodes, pr] = await Promise.all([
    fetchAssemblyRunNodes(run.id),
    run.prNumber ? fetchPrStatus(repo, run.prNumber) : null,
  ]);

  return { ...planRunOf(run), nodes, ...specPrFactsOf(pr) };
}

type SpecPrFacts = Pick<PlanRun, "prTitle" | "prUnresolvedThreads">;

const UNASKED: SpecPrFacts = { prTitle: null, prUnresolvedThreads: null };

// What GitHub said about the spec PR, or nothing when nobody could ask.
function specPrFactsOf(pr: PrStatus | null): SpecPrFacts {
  return pr
    ? { prTitle: pr.title, prUnresolvedThreads: pr.unresolved_threads }
    : UNASKED;
}

function planRunOf(
  run: AssemblyRun,
): Omit<PlanRun, "nodes" | "prTitle" | "prUnresolvedThreads"> {
  const { id, status, outcome, reason, prUrl, prNumber } = run;

  return {
    id,
    status,
    outcome,
    reason,
    prUrl,
    prNumber,
    specPlanSummary: run.specPlanSummary ?? null,
  };
}
