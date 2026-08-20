import { getAssemblyLineDefinition } from "@/lib/api/assembly-lines";
import { runIdOf } from "@/lib/api/run-id";
import {
  getFeature,
  getFeatureDecomposition,
  getFeatureStatus,
} from "@/lib/api/features";
import { fetchFeatureRunById } from "@/lib/feature-run";
import { listAgents } from "@/lib/agents-api";
import {
  groupDecomposition,
  type DecompTaskRow,
} from "@/lib/decomposition-view";
import type { FeatureWithIterations } from "@/lib/feature-types";
import FeatureDetailView from "./FeatureDetailView";
import PlatformOutageBanner from "./PlatformOutageBanner";
import { getPlatformLlmStatus } from "@/lib/api/platform-status";
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

  // The line this feature is on, so the card above draws where the walk actually
  // is rather than everything it could ever do. lore-api resolved which line the
  // feature hangs on (from round 2 a resumed round mints no task of its own), so
  // the id comes from the status endpoint rather than from the latest round.
  const status = await getFeatureStatus(fullName, id);
  const run =
    status.status === "ok"
      ? await fetchFeatureRunById(runIdOf(status.data))
      : null;

  // Above the feature's own state, because when this fires the feature's state is
  // a symptom. Healthy is the overwhelmingly common answer and renders nothing.
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
        finalize={finalizeFeatureAction.bind(null, fullName, id)}
        split={splitFeatureAction.bind(null, fullName, id)}
        del={deleteFeatureAction.bind(null, fullName, id)}
      />
    </>
  );
}
