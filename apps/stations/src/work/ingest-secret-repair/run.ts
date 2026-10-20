// Binds the ingest secret repair to the ports this process holds (composition root).
import { configureIngestCallback } from "@re-cinq/lore-shared/onboard/onboard-ingest-callback.js";
import { projectFor } from "../../outbound/project-boot.js";
import { settings } from "../../outbound/queues.js";
import { ingestSecretRepair } from "./ingest-secret-repair.js";

export async function runIngestSecretRepair(): Promise<string> {
  return ingestSecretRepair({
    repos: async () =>
      (await settings().onboardedRepos()).map((repo) => repo.full_name).sort(),
    configure: async (repo) =>
      configureIngestCallback((await projectFor(repo)).settings),
    log: (line) => console.log(`[ingest-secret-repair] ${line}`),
  });
}
