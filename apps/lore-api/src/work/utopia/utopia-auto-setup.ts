// A repo's first mirrored ingest sets its Utopia knowledge base up when the deployment holds a Utopia write token: the setup a person runs through the setup route, run as the Utopia person Lore acts as, in the workspace the deployment names.

import {
  utopiaClientFrom,
  type UtopiaEnv,
  type UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import type { StoredUtopiaSource } from "../../outbound/utopia-sources.js";
import { setUpRepoInUtopia, storeUtopiaSetup } from "./utopia-setup.js";

const settingUp = new Map<string, Promise<UtopiaSource>>();

/** Two ingests of one repo in this process share one setup. Across processes, finding the base by name and the one-row-per-repo upsert keep it at one base, and the source saved last wins. */
export function autoSetUpRepo(
  pool: Pool,
  repo: string,
  existing: StoredUtopiaSource | null,
  env: UtopiaEnv,
): Promise<UtopiaSource> {
  const key = repo.toLowerCase();
  const running =
    settingUp.get(key) ??
    setUpAndStore(pool, repo, existing, env).finally(() =>
      settingUp.delete(key),
    );

  settingUp.set(key, running);

  return running;
}

async function setUpAndStore(
  pool: Pool,
  repo: string,
  existing: StoredUtopiaSource | null,
  env: UtopiaEnv,
): Promise<UtopiaSource> {
  const lore = utopiaClientFrom(env).withCredential(env.UTOPIA_TOKEN!);
  const setup = await setUpRepoInUtopia(lore, {
    repo,
    workspaceId: env.UTOPIA_WORKSPACE_ID!,
    existing,
  });

  await storeUtopiaSetup(pool, repo, setup);

  return { id: setup.source.id, key: setup.source.key };
}
