import { notFound } from "next/navigation";
import { planMetaSchema, type PlanMeta } from "@re-cinq/planning-document";
import { readPlan } from "@/lib/api/plans";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import { planRunFor } from "./plan-run-facts";
import PlanDetailStory from "./PlanDetailStory";
import {
  approvePlanAction,
  deletePlanAction,
  draftAgainAction,
  openPlanSocketAction,
  refinePlanAction,
  refreshPlanRunFactsAction,
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
    <PlanDetailStory
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
    refreshRunFacts: refreshPlanRunFactsAction.bind(null, fullName, id),
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
