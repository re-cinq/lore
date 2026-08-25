/**
 * The author reviewing their own feature plan.
 *
 * A human station: the worker is a person in the planning wizard, not a pod.
 * There is no handler — `StationModule`'s manifest-only variant is exactly this
 * case — and the registry carries it so the loader's `feature_review` node type
 * has something declaring it, rather than being a type nothing answers to.
 *
 * No route here. The page a run parks on belongs to the NODE, not the station:
 * it is declared per-node in the YAML, snapshotted into the run graph, and
 * resolved from that run's args (`resolveRoute`). A station-level route could
 * not know whether this round parks on the feature page or somewhere else, and
 * a second copy of a value with no reader is how parallel lists start.
 */

import type { HumanStationModule } from "../lib/station.js";

export const featureReview: HumanStationModule = {
  manifest: {
    name: "feature-review",
    description:
      "The author reads the round's gap result and answers it in the wizard.",
    triggers: [{ kind: "human", nodeType: "feature_review" }],
  },
};
