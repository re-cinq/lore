/**
 * A person reviewing the pull request a planning line opened.
 *
 * The second human station. Its node parks on the PR itself — the YAML routes
 * it to `{args.pr_url}`, which resolves only once `push` has opened the PR and
 * stamped that arg. That is per-node and per-run, so it is not restated here;
 * see the sibling `feature-review` manifest for why.
 */

import type { HumanStationModule } from "../lib/station.js";

export const prReview: HumanStationModule = {
  manifest: {
    name: "pr-review",
    description: "A person reviews the pull request the line opened.",
    triggers: [{ kind: "human", nodeType: "pr_review" }],
  },
};
