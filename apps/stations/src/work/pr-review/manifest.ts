/** Human station: person reviews the PR that planning opened (parks on PR via args.pr_url). */

import type { HumanStationModule } from "../lib/station.js";

export const prReview: HumanStationModule = {
  manifest: {
    name: "pr-review",
    description: "A person reviews the pull request the line opened.",
    triggers: [{ kind: "human", nodeType: "pr_review" }],
  },
};
