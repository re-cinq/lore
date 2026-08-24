import type { NodeStationModule } from "../../lib/station.js";
import { runGithubActionStation } from "./github-action.js";

/**
 * Gate on the repo's real GitHub Actions conclusion for the branch.
 *
 * Runtime — Referenced by no blueprint today; kept only until the node type is retired.
 */
export const githubAction: NodeStationModule = {
  manifest: {
    name: "github-action",
    description:
      "Gate on the repo's real GitHub Actions conclusion for the branch.",
    triggers: [
      {
        kind: "node",
        nodeType: "github_action",
        runtime: "pod",
        outcomes: ["success", "failed"],
        timeoutMinutes: 60,
      },
    ],
  },
  run: runGithubActionStation,
};
