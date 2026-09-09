/** Human station: the pull request's own CI decides (parks on the PR via args.pr_url; the pr-ready-check sweep reports the verdict). */

import type { HumanStationModule } from "../lib/station.js";

export const ciCheck: HumanStationModule = {
  manifest: {
    name: "ci-check",
    description: "GitHub Actions judges the round the line just pushed.",
    triggers: [{ kind: "human", nodeType: "ci_check" }],
  },
};
