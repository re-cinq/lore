// A repo's first mirrored ingest sets its Utopia knowledge base up when the deployment holds a Utopia write token: the setup a person runs through the setup route, run as the Utopia person Lore acts as, in the workspace the deployment names. A base set up under an older ontology is upgraded the same way.

import { LORE_ONTOLOGY_VERSION } from "@re-cinq/lore-shared/lore-ontology.js";
import type { UtopiaMirrorSettings } from "@re-cinq/lore-shared/models/repo-settings.js";
import {
  utopiaClientFrom,
  type UtopiaEnv,
  type UtopiaSession,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import {
  saveUtopiaMirrorSettings,
  type StoredUtopiaSource,
} from "../../outbound/utopia-sources.js";
import {
  installOntology,
  setUpRepoInUtopia,
  storeUtopiaSetup,
} from "./utopia-setup.js";

const settingUp = new Map<string, Promise<StoredUtopiaSource>>();
const upgrading = new Map<string, Promise<void>>();

/** Two ingests of one repo in this process share one setup. Across processes, finding the base by name and the one-row-per-repo upsert keep it at one base, and the source saved last wins. */
export function autoSetUpRepo(
  pool: Pool,
  repo: string,
  existing: StoredUtopiaSource | null,
  env: UtopiaEnv,
): Promise<StoredUtopiaSource> {
  return sharedPerRepo(settingUp, repo, () =>
    setUpAndStore(pool, repo, existing, env),
  );
}

/** Re-imports the ontology into the repo's base and stores the version it now holds; two ingests of one repo in this process share one upgrade. */
export function autoUpgradeOntology(
  pool: Pool,
  repo: string,
  mirror: UtopiaMirrorSettings,
  env: UtopiaEnv,
): Promise<void> {
  return sharedPerRepo(upgrading, repo, async () => {
    await installOntology(loreSession(env), mirror.kb_id);
    await saveUtopiaMirrorSettings(pool, repo, {
      ...mirror,
      ontology_version: LORE_ONTOLOGY_VERSION,
    });
  });
}

/** One call per key runs at a time in this process; a second call while it runs shares its answer. */
export function sharedPerRepo<T>(
  running: Map<string, Promise<T>>,
  repo: string,
  start: () => Promise<T>,
): Promise<T> {
  const key = repo.toLowerCase();
  const shared = running.get(key) ?? start().finally(() => running.delete(key));

  running.set(key, shared);

  return shared;
}

async function setUpAndStore(
  pool: Pool,
  repo: string,
  existing: StoredUtopiaSource | null,
  env: UtopiaEnv,
): Promise<StoredUtopiaSource> {
  const setup = await setUpRepoInUtopia(loreSession(env), {
    repo,
    workspaceId: env.UTOPIA_WORKSPACE_ID!,
    existing,
  });

  await storeUtopiaSetup(pool, repo, setup);

  return setup.source;
}

export function loreSession(env: UtopiaEnv): UtopiaSession {
  return utopiaClientFrom(env).withCredential(env.UTOPIA_TOKEN!);
}
