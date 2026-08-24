import type { NodeStationModule } from "../../lib/station.js";
import { runIssuesStation } from "./issues.js";

/**
 * File the Issues and spec-tasks a decomposition calls for.
 *
 * Runtime — Pooled: writes over HTTP, seconds of work, no clone and no untrusted input.
 */
export const issues: NodeStationModule = {
  manifest: {
    name: "issues",
    description: "File the Issues and spec-tasks a decomposition calls for.",
    triggers: [
      {
        kind: "node",
        nodeType: "issues",
        runtime: "service",
        outcomes: ["success", "changes_requested", "failed"],
        timeoutMinutes: 10,
      },
    ],
  },
  // Its second parameter is a test seam, not the pod env; passing StationEnv
  // straight in would hand it an object it does not understand.
  run: (input) => runIssuesStation(input),
};
