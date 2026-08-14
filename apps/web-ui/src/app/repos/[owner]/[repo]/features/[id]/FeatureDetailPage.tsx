import { getAssemblyLineDefinition } from "@/lib/api/assembly-lines";
import { getFeature, getFeatureDecomposition } from "@/lib/api/features";
import { listAgents } from "@/lib/agents-api";
import {
  groupDecomposition,
  type DecompTaskRow,
} from "@/lib/decomposition-view";
import type { FeatureWithIterations } from "@/lib/feature-types";
import FeatureDetailView from "./FeatureDetailView";
import {
  refineFeatureAction,
  finalizeFeatureAction,
  splitFeatureAction,
  deleteFeatureAction,
} from "./actions";

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
        <p className="meta">Feature not found.</p>
      </div>
    );
  }
  const full: FeatureWithIterations = feature;

  // The story/task tree a merged spec decomposed into (ADR-029), if any.
  const decomp = await getFeatureDecomposition(fullName, id);
  const decomposition = groupDecomposition(
    decomp.status === "ok" ? (decomp.data.tasks as DecompTaskRow[]) : [],
  );

  // The planning round's time budget (the feature-planning agent's timeout), resolved
  // once for the wizard's elapsed/total timer. Defaults to 15 if unresolved.
  const planningTimeoutMinutes =
    (await listAgents(fullName)).find((a) => a.name === "feature-planning")
      ?.timeout_minutes ?? 15;

  const definition = await getAssemblyLineDefinition("feature-planning");

  return (
    <FeatureDetailView
      definition={definition}
      owner={owner}
      repo={repo}
      feature={full}
      timeoutMinutes={planningTimeoutMinutes}
      decomposition={decomposition}
      refine={refineFeatureAction.bind(null, fullName, id)}
      finalize={finalizeFeatureAction.bind(null, fullName, id)}
      split={splitFeatureAction.bind(null, fullName, id)}
      del={deleteFeatureAction.bind(null, fullName, id)}
    />
  );
}
