import type { SweepStationModule } from "../lib/station.js";

/**
 * Notice merged and closed PRs, and settle what each one implies.
 *
 * Still reaches the kernel singletons directly rather than taking ports like the
 * other sweeps. That is deliberate and temporary: it is about to be decomposed
 * into the nodes of a merge assembly line (FR12), where each step becomes its own
 * station with its own ports — converting its ~25 data calls first, only to split
 * them apart immediately after, would be work done twice.
 *
 * It declares `repoFor` because that IS true of it — it reads and writes PRs
 * through the code host — and because a sweep with NO declared ports passes every
 * host's check vacuously, which had lore-api advertising a job it cannot run.
 */
export const mergeCheck: SweepStationModule = {
  manifest: {
    name: "merge-check",
    description: "Settle tasks whose PR merged or closed.",
    triggers: [{ kind: "cron", schedule: "*/1 * * * *" }, { kind: "http" }],
    requires: ["repoFor"],
  },
  run: async () => (await import("./merge-check.js")).mergeCheckJob(),
};
