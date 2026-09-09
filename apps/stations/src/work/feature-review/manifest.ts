// The author reviewing their own feature plan — a human station: the worker is a person in the planning wizard, not a pod, so there's no handler (StationModule's manifest-only variant); the registry carries it so feature_review has something declaring it. No route here: the page a run parks on belongs to the NODE (declared per-node in YAML, resolved via resolveRoute), not the station.

import type { HumanStationModule } from "../lib/station.js";

export const featureReview: HumanStationModule = {
  manifest: {
    name: "feature-review",
    description:
      "The author reads the round's gap result and answers it in the wizard.",
    triggers: [{ kind: "human", nodeType: "feature_review" }],
  },
};
