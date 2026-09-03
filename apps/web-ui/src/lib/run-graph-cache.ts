// Graph caching: whether to keep graph across poll ticks, how to fold omitted ones back in (#1238); pure module, no IO/React.

import type { FeatureRunPayload } from "./feature-run";

/** May client keep graph across poll ticks? Real runs cache (immutable clone); synthetic graphs re-send every tick (grows each visit). */
export function graphIsCacheable(run: FeatureRunPayload): boolean {
  return !run.synthetic && run.definition !== null;
}

/** Fold polled run into cached one, restoring omitted graph; keyed on run ID to prevent stale graph on retry. */
export function mergeRunGraph(
  previous: FeatureRunPayload | null,
  next: FeatureRunPayload,
): FeatureRunPayload {
  if (!next.definitionUnchanged || next.definition !== null) {
    return next;
  }

  return previous && previous.id === next.id
    ? {
        ...next,
        definition: previous.definition,
        synthetic: previous.synthetic,
      }
    : next;
}
