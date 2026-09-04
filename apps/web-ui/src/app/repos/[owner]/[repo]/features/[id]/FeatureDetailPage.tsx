import { Alert } from "@/components/Alert";
import { getAssemblyLineDefinition } from "@/lib/api/assembly-lines";
import { runIdOf } from "@/lib/api/run-id";
import {
  getFeature,
  getFeatureDecomposition,
  getFeatureStatus,
} from "@/lib/api/features";
import { fetchFeatureRunById } from "@/lib/feature-run";
import { listAgents } from "@/lib/agents-api";
import { groupDecomposition } from "@/lib/decomposition-view";
import type { FeatureWithIterations } from "@/lib/feature-types";
import FeatureDetailView from "./FeatureDetailView";
import PlatformOutageBanner from "./PlatformOutageBanner";
import { getPlatformLlmStatus } from "@/lib/api/platform-status";
import {
  refineFeatureAction,
  handleCreateSpecFile,
  splitFeatureAction,
  deleteFeatureAction,
} from "./actions";
import { decompositionRows, planningTimeoutOf } from "./page-input";

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;

  const result = await getFeature(fullName, id);
  const feature = result.status === "ok" ? result.data : null;

  if (!feature) {
    return (
      <div className="spec-card">
        <Alert variant="secondary">Feature not found.</Alert>
      </div>
    );
  }
  const full: FeatureWithIterations = feature;

  // The story/task tree a merged spec decomposed into (ADR-029), if any.
  const decomp = await getFeatureDecomposition(fullName, id);
  const decomposition = groupDecomposition(decompositionRows(decomp));

  const planningTimeoutMinutes = planningTimeoutOf(await listAgents(fullName));

  const definition = await getAssemblyLineDefinition("feature-planning");

  // Which line the feature is on, resolved by lore-api; the id comes from status endpoint.
  const status = await getFeatureStatus(fullName, id);
  const run =
    status.status === "ok"
      ? await fetchFeatureRunById(runIdOf(status.data))
      : null;

  // Platform status above feature state: when it fires, the feature's state is a symptom.
  const platform = await getPlatformLlmStatus();

  return (
    <>
      <PlatformOutageBanner status={platform} />
      <FeatureDetailView
        definition={definition}
        run={run}
        owner={owner}
        repo={repo}
        feature={full}
        timeoutMinutes={planningTimeoutMinutes}
        decomposition={decomposition}
        refine={refineFeatureAction.bind(null, fullName, id)}
        onCreateSpecFile={handleCreateSpecFile.bind(null, fullName, id)}
        split={splitFeatureAction.bind(null, fullName, id)}
        del={deleteFeatureAction.bind(null, fullName, id)}
      />
    </>
  );
}
