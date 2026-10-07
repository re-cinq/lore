import type { SweepStationModule } from "../lib/station.js";

export const issueTriageTickStation: SweepStationModule = {
  manifest: {
    name: "issue-triage-tick",
    description:
      "Start one issue-triage run on the external floor per qualifying needs-triage issue, oldest first, respecting the per-repo concurrency cap.",
    triggers: [
      { kind: "event", eventNames: ["cron.issue_triage.tick"] },
      { kind: "http" },
    ],
  },
  run: async (ctx) =>
    (await import("./run.js")).runIssueTriageTick(ctx.event?.params ?? {}),
};
