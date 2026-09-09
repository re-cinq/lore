import type { NodeStationModule } from "../lib/station.js";

/** Pod executes repo's lint/typecheck; never shares process with GitHub App key. */
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
