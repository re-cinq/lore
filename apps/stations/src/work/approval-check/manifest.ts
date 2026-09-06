import type { SweepStationModule } from "../lib/station.js";

// Two triggers on purpose: `github.issues.labeled` is the FAST path (was being discarded before), and the hourly cron is a RECONCILER for deliveries that never arrive — webhooks are lossy, so event-driven plus a slow sweep beats either alone.
export const approvalCheck: SweepStationModule = {
  manifest: {
    name: "approval-check",
    description: "Promote a task once a human approves its issue.",
    triggers: [
      { kind: "event", eventNames: ["github.issues.labeled"] },
      { kind: "cron", schedule: "23 * * * *" },
      { kind: "http" },
    ],
    requires: ["awaitingApproval", "approvalLabel", "repoFor"],
  },
  run: async (ctx) =>
    (await import("./approval-check.js")).runApprovalCheck(ctx.host),
};
