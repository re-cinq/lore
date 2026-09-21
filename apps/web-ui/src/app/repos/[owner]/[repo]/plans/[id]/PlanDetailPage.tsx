import { notFound } from "next/navigation";
import { planMetaSchema, type PlanMeta } from "@re-cinq/planning-document";
import { readPlan } from "@/lib/api/plans";
import { fetchAssemblyRunNodes, fetchPlanRun } from "@/lib/assembly-runs";
import { definitionForRun } from "@/lib/run-graph-definition";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import PlanDetailView from "./PlanDetailView";
import type { PlanRun } from "./PlanRunCard";
import {
  approvePlanAction,
  openPlanSocketAction,
  refinePlanAction,
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
      openSocket={openPlanSocketAction.bind(null, fullName, id)}
      approve={approvePlanAction.bind(null, fullName, id)}
      refine={refinePlanAction.bind(null, fullName, id)}
    />
  );
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

// The plan's planning run with its visits and graph, or null before one has started.
async function planRunFor(
  repo: string,
  planId: string,
): Promise<PlanRun | null> {
  const run = await fetchPlanRun(repo, planId);

  if (!run) {
    return null;
  }
  const nodes = await fetchAssemblyRunNodes(run.id);
  const { definition } = definitionForRun(run.blueprintName, nodes, run.graph);
  const { id, status, reason, prUrl, prNumber } = run;

  return { id, status, reason, repo, prUrl, prNumber, definition, nodes };
}
