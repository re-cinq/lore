import type { SweepStationModule } from "../lib/station.js";

/** The weekly webhook ensure (specs/external-floor FR12.19c): every onboarded repository's GitHub webhook asked for every event Lore requires, so none is left without the check_suite the loop's upkeep listens for. */
export const webhookEnsureTickStation: SweepStationModule = {
  manifest: {
    name: "webhook-ensure-tick",
    description:
      "Point every onboarded repository's GitHub webhook at Lore with every event it requires.",
    triggers: [
      { kind: "event", eventNames: ["cron.webhook_ensure.tick"] },
      { kind: "http" },
    ],
  },
  run: async () => (await import("./run.js")).runWebhookEnsureTick(),
};
