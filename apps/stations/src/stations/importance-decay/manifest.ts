import type { SweepStationModule } from "../lib/station.js";

// Scores and evicts memories past the per-agent cap; ages unretrieved facts. A single scheduled data op that runs beside the data rather than in its own pod; the host supplies the port since this package is shared with a pod that has none.
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
