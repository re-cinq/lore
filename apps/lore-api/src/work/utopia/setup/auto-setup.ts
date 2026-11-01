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
  EXTRACTION_OFF_KINDS,
  kindSourceFor,
} from "../../../outbound/utopia/kind-sources.js";
import { saveUtopiaMirrorSettings } from "../../../outbound/utopia/sources.js";
import {
  installOntology,
  setUpRepoInUtopia,
  storeUtopiaSetup,
} from "./setup.js";

const settingUp = new Map<string, Promise<string>>();
const upgrading = new Map<string, Promise<void>>();
const silencing = new Map<string, Promise<void>>();

/** Answers the id of the knowledge base set up. Two ingests of one repo in this process share one setup; across processes, finding the base by name keeps it at one base. */
export function autoSetUpRepo(
  pool: Pool,
  repo: string,
  env: UtopiaEnv,
): Promise<string> {
  return sharedPerRepo(settingUp, repo, () => setUpAndStore(pool, repo, env));
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

/** Patches the repo's stored `git-history` and `github` sources to `extract: false` and stores that it was done once there was a source to patch (one made after this is born off); two ingests of one repo in this process share one pass. */
export function autoSilenceExtraction(
  pool: Pool,
  repo: string,
  mirror: UtopiaMirrorSettings,
  env: UtopiaEnv,
): Promise<void> {
  return sharedPerRepo(silencing, repo, async () => {
    const patched = await patchStoredSources(pool, repo, mirror.kb_id, env);

    if (patched > 0) {
      await saveUtopiaMirrorSettings(pool, repo, {
        kb_id: mirror.kb_id,
        sources_extract_off: true,
      });
    }
  });
}

async function patchStoredSources(
  pool: Pool,
  repo: string,
  kbId: string,
  env: UtopiaEnv,
): Promise<number> {
  const session = loreSession(env);
  const stored = await Promise.all(
    EXTRACTION_OFF_KINDS.map((kind) => kindSourceFor(pool, repo, kind)),
  );
  const inBase = stored.filter((source) => source?.kbId === kbId);

  await Promise.all(
    inBase.map((source) =>
      session.patchSourceConfig(kbId, source!.id, { extract: false }),
    ),
  );

  return inBase.length;
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
  env: UtopiaEnv,
): Promise<string> {
  const settings = await setUpRepoInUtopia(loreSession(env), {
    repo,
    workspaceId: env.UTOPIA_WORKSPACE_ID!,
  });

  await storeUtopiaSetup(pool, repo, settings);

  return settings.kb_id;
}

export function loreSession(env: UtopiaEnv): UtopiaSession {
  return utopiaClientFrom(env).withCredential(env.UTOPIA_TOKEN!);
}
