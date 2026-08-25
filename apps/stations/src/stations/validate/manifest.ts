import type { NodeStationModule } from "../lib/station.js";

/**
 * Run the target repo's own lint and typecheck against the cloned branch.
 *
 * Runtime — A pod: it EXECUTES the target repo's declared commands, which must never share a
 *  process with the GitHub App key, and it needs the branch checked out.
 */
export const validate: NodeStationModule = {
  manifest: {
    name: "validate",
    description:
      "Run the target repo's own lint and typecheck against the cloned branch.",
    triggers: [
      {
        kind: "node",
        nodeType: "validate",
        runtime: "pod",
        clone: true,
        outcomes: ["success", "failed"],
        timeoutMinutes: 15,
      },
    ],
  },
  run: async (input, env) =>
    (await import("./validate.js")).runValidateStation(input, env),
};
