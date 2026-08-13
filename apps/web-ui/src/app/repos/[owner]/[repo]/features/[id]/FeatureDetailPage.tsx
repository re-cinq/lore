import { getAssemblyLineDefinition } from "@/lib/api/assembly-lines";
import { queryAllowMissing } from "@/lib/db";
import { listAgents } from "@/lib/agents-api";
import {
  groupDecomposition,
  type DecompTaskRow,
} from "@/lib/decomposition-view";
import type {
  FeatureRow,
  FeatureIterationRow,
  FeatureWithIterations,
} from "@/lib/feature-types";
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

  const features = await queryAllowMissing<FeatureRow>(
    `SELECT * FROM lore.features WHERE id = $1 AND repo = $2`,
    [id, fullName],
  );
  const feature = features[0];

  if (!feature) {
    return (
      <div className="spec-card">
        <p className="meta">Feature not found.</p>
      </div>
    );
  }
  const iterations = await queryAllowMissing<FeatureIterationRow>(
    `SELECT * FROM lore.feature_iterations WHERE feature_id = $1 ORDER BY iteration ASC`,
    [id],
  );
  const full: FeatureWithIterations = { ...feature, iterations };

  // The story/task tree a merged spec decomposed into (ADR-029), if any.
  const decompRows = await queryAllowMissing<DecompTaskRow>(
    `SELECT description, status, context_bundle FROM pipeline.tasks
      WHERE task_type = 'spec-task' AND target_repo = $2 AND context_bundle->>'feature_id' = $1
      ORDER BY context_bundle->>'spec_task_id'`,
    [id, fullName],
  );
  const decomposition = groupDecomposition(decompRows);

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
