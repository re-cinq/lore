// Should a just-merged spec PR kick decomposition?
//
// Pure, and deliberately separate from the execution: decomposition itself runs as
// the `feature-decompose` assembly line (agent → issues station), so the only Floor
// side left is deciding whether to start one.

interface FinalizeTaskShape {
  task_type?: string;
  context_bundle?: { feature_id?: string; slug?: string } | null;
}

/** Fires only for a `feature-finalize` task that carries a feature id. */
export function decideDecomposeKick(task: FinalizeTaskShape): {
  kick: boolean;
  featureId?: string;
  slug?: string;
} {
  if (task.task_type !== "feature-finalize") {
    return { kick: false };
  }
  const featureId = task.context_bundle?.feature_id;

  if (!featureId) {
    return { kick: false };
  }

  return { kick: true, featureId, slug: task.context_bundle?.slug };
}
