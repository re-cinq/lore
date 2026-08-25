import type { SweepStationModule } from "../lib/station.js";

/**
 * Score and evict memories past the per-agent cap; age unretrieved facts.
 *
 * A single data operation on a schedule, so it runs beside the data rather than
 * in a pod of its own. The host supplies the port; this package is shared with a
 * pod that has none.
 */
export const importanceDecayStation: SweepStationModule = {
  manifest: {
    name: "importance-decay",
    description:
      "Score and evict memories past the per-agent cap; age unretrieved facts.",
    triggers: [{ kind: "cron", schedule: "0 5 * * *" }, { kind: "http" }],
    requires: ["memoryLifecycle"],
  },
  run: async (ctx) =>
    (await import("./importance-decay.js")).importanceDecay(
      ctx.host.memoryLifecycle(),
    ),
};
