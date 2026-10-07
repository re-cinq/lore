import { FormError } from "@/components/FormError";
import { listPlans } from "@/lib/api/plans";
import type { ApiResult } from "@/lib/api/result";
import PlanListView from "./PlanListView";

export default async function PlansPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const result = await listPlans(`${owner}/${repo}`);

  if (result.status !== "ok") {
    return <FormError message={loadFailureMessage(result)} />;
  }

  return (
    <PlanListView
      base={`/repos/${owner}/${repo}/plans`}
      plans={result.data.plans}
    />
  );
}

// A failed or unconfigured call reads here instead of as the same empty list a repo with zero plans would show.
function loadFailureMessage(
  result: Exclude<ApiResult, { status: "ok" }>,
): string {
  return result.status === "unconfigured"
    ? "Plans are unavailable: lore-api isn't configured."
    : `Couldn't load plans: ${result.message}`;
}
