// The plan's people reviewing the agent's draft — a human station: the workers are people in the plan editor, not a pod, so there's no handler (StationModule's manifest-only variant); the registry carries it so feature_review has something declaring it. No route here: the page a run parks on belongs to the NODE (declared per-node in YAML, resolved via resolveRoute), not the station.

import type { HumanStationModule } from "../lib/station.js";

export const featureReview: HumanStationModule = {
  manifest: {
    name: "feature-review",
    description:
      "People write the plan with the agent, refine its sections, and approve it.",
    triggers: [{ kind: "human", nodeType: "feature_review" }],
  },
};
