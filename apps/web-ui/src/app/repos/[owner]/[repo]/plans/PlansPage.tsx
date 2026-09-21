import { listPlans } from "@/lib/api/plans";
import PlanListView from "./PlanListView";

export default async function PlansPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const result = await listPlans(`${owner}/${repo}`);
  const plans = result.status === "ok" ? result.data.plans : [];

  return <PlanListView base={`/repos/${owner}/${repo}/plans`} plans={plans} />;
}
