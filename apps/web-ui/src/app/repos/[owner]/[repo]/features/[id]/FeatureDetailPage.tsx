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

/** The four server actions the view can invoke, each pre-bound to this feature. Bound here rather than passed the ids: a client component cannot construct a server action, and handing it the ids would mean trusting the client to say which feature it is acting on. */
function featureActions(fullName: string, id: string) {
  return {
    refine: refineFeatureAction.bind(null, fullName, id),
    onCreateSpecFile: handleCreateSpecFile.bind(null, fullName, id),
    split: splitFeatureAction.bind(null, fullName, id),
    del: deleteFeatureAction.bind(null, fullName, id),
  };
}

function FeatureNotFound() {
  return (
    <div className="spec-card">
      <Alert variant="secondary">Feature not found.</Alert>
    </div>
  );
}

/** Everything the detail view reads besides the feature itself. The platform LLM status is fetched alongside because it OUTRANKS feature state: when the platform is down, a stalled feature is a symptom rather than the story. */
async function resolveFeatureView(fullName: string, id: string) {
  const [decomp, agents, definition, status, platform] = await Promise.all([
    getFeatureDecomposition(fullName, id),
    listAgents(fullName),
    getAssemblyLineDefinition("feature-planning"),
    getFeatureStatus(fullName, id),
    getPlatformLlmStatus(),
  ]);

  return {
    // The story/task tree a merged spec decomposed into (ADR-029), if any.
    decomposition: groupDecomposition(decompositionRows(decomp)),
    planningTimeoutMinutes: planningTimeoutOf(agents),
    definition,
    platform,
    // Which line the feature is on; lore-api resolves it, and the id comes from the status endpoint.
    run:
      status.status === "ok"
        ? await fetchFeatureRunById(runIdOf(status.data))
        : null,
  };
}

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;

  const result = await getFeature(fullName, id);

  if (result.status !== "ok") {
    return <FeatureNotFound />;
  }
  const full: FeatureWithIterations = result.data;
  const view = await resolveFeatureView(fullName, id);

  return (
    <>
      <PlatformOutageBanner status={view.platform} />
      <FeatureDetailView
        definition={view.definition}
        run={view.run}
        owner={owner}
        repo={repo}
        feature={full}
        timeoutMinutes={view.planningTimeoutMinutes}
        decomposition={view.decomposition}
        {...featureActions(fullName, id)}
      />
    </>
  );
}
