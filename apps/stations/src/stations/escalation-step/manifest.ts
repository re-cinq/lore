import type { NodeStationModule } from "../lib/station.js";

/**
 * One step of the escalation line.
 *
 * Parameterised by `job_ref`, the shape `merge_step` and `detect` already use:
 * two steps that share a form and differ only in which piece of telling-a-human
 * they do.
 *
 * Runtime is the pooled service. Both steps are a GitHub call or a database
 * write over data the platform produced itself — no clone, nothing untrusted,
 * no deadline of their own. Five minutes is generous for either; the point of
 * the budget is that a wedged Issue call is reaped rather than leaving the
 * escalation — and therefore the human — waiting on the global hour.
 */
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
