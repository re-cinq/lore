import { notFound } from "next/navigation";
import { planMetaSchema, type PlanMeta } from "@re-cinq/planning-document";
import { readPlan } from "@/lib/api/plans";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";
import PlanDetailView from "./PlanDetailView";
import { approvePlanAction, openPlanSocketAction } from "./actions";

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;
  const meta = await repoPlanMeta(fullName, id);

  return (
    <PlanDetailView
      meta={meta}
      user={planUserOf((await getSession()) as PlanSession | null)}
      openSocket={openPlanSocketAction.bind(null, fullName, id)}
      approve={approvePlanAction.bind(null, fullName, id)}
    />
  );
}

// A plan is only shown under the repo it belongs to.
async function repoPlanMeta(fullName: string, planId: string): Promise<PlanMeta> {
  const stored = await readPlan(planId);
  const plan = stored.status === "ok" ? stored.data.json : undefined;

  if (plan?.repo !== fullName) {
    notFound();
  }

  return planMetaSchema.parse(plan);
}
