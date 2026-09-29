import type { NodeStationModule } from "../lib/station.js";

/** Leaves lint/typecheck to the pull request's CI; never shares process with GitHub App key. */
export const validate: NodeStationModule = {
  manifest: {
    name: "validate",
    description:
      "Defer the branch's lint, typecheck and build to the pull request's CI.",
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
