import type { NodeStationModule } from "../lib/station.js";

// One step of the escalation line, parameterised by `job_ref` like `merge_step` and `detect` already are. Runtime is the pooled service: both steps are a GitHub call or DB write over platform-produced data (no clone, nothing untrusted); 5 minutes just reaps a wedged Issue call instead of leaving the human waiting on the global hour.
export const escalationStep: NodeStationModule = {
  manifest: {
    name: "escalation-step",
    description: "Run one step of the escalation line.",
    triggers: [
      {
        kind: "node",
        nodeType: "escalation_step",
        runtime: "service",
        outcomes: ["success", "failed"],
        timeoutMinutes: 5,
      },
    ],
  },
  run: async (input) => (await import("./run.js")).runEscalationStepNode(input),
};
