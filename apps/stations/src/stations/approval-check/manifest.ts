import type { SweepStationModule } from "../lib/station.js";

/**
 * Promote tasks whose issue has gained the approval label.
 *
 * Two triggers on purpose. `github.issues.labeled` is the FAST path — the event
 * already exists and was being discarded, while a sweep asked the database the
 * same question every 60 seconds. The cron stays as a RECONCILER for the
 * delivery that never arrives, at an hour rather than a minute: webhooks are
 * lossy, and event-driven plus a slow sweep is strictly more reliable than
 * either alone.
 */
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
