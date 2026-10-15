// Sets a repository up in Utopia, as a person or as the Utopia person Lore acts as: its knowledge base in their workspace, the Lore ontology and kind words in it, and the one statements source the ingest pushes through.

import {
  LORE_KIND_WORDS,
  LORE_ONTOLOGY_VERSION,
  loreOntologyTurtle,
} from "@re-cinq/lore-shared/lore-ontology.js";
import type { UtopiaMirrorSettings } from "@re-cinq/lore-shared/models/repo-settings.js";
import type {
  UtopiaSession,
  UtopiaSource,
} from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import {
  saveUtopiaMirrorSettings,
  saveUtopiaSource,
  type StoredUtopiaSource,
} from "../../outbound/utopia-sources.js";

export interface UtopiaSetupInput {
  repo: string;
  workspaceId: string;
  /** The source lore.utopia_sources already holds a key for, so a source set up before keeps it. */
  existing: StoredUtopiaSource | null;
}

/** The settings block holds no key: settings are served whole at read scope, so the key travels apart, to lore.utopia_sources. */
export interface UtopiaSetup {
  settings: UtopiaMirrorSettings;
  source: StoredUtopiaSource;
}

export async function setUpRepoInUtopia(
  session: UtopiaSession,
  input: UtopiaSetupInput,
): Promise<UtopiaSetup> {
  const kbId = await knowledgeBaseFor(session, input.workspaceId, input.repo);

  await installOntology(session, kbId);
  const source = await sourceFor(session, kbId, input.existing);

  return {
    settings: {
      kb_id: kbId,
      source_id: source.id,
      ontology_version: LORE_ONTOLOGY_VERSION,
    },
    source: { ...source, kbId },
  };
}

/** The key first, to lore.utopia_sources, then the ids to settings: settings never name a source whose key is not stored. */
export async function storeUtopiaSetup(
  pool: Pool,
  repo: string,
  { settings, source }: UtopiaSetup,
): Promise<void> {
  await saveUtopiaSource(pool, {
    repo,
    kbId: source.kbId,
    sourceId: source.id,
    key: source.key,
  });
  await saveUtopiaMirrorSettings(pool, repo, settings);
}

/** Idempotent on Utopia's side: a re-import of the same turtle plans no change, and a kind word bound again stays bound. */
async function installOntology(
  session: UtopiaSession,
  kbId: string,
): Promise<void> {
  await session.importOntology(
    kbId,
    await loreOntologyTurtle(),
    "lore-ontology.ttl",
  );
  await Promise.all(
    LORE_KIND_WORDS.map(({ word, classKey }) =>
      session.bindKindWord(kbId, word, classKey),
    ),
  );
}

async function knowledgeBaseFor(
  session: UtopiaSession,
  workspaceId: string,
  repo: string,
): Promise<string> {
  const listed = await session.listKnowledgeBases(workspaceId);
  const found = listed.find((kb) => kb.name === repo);

  return found
    ? found.id
    : (await session.createKnowledgeBase(workspaceId, repo)).id;
}

/** A source set up before is kept only while its key is stored, since Utopia hands a source's key out once, at creation. */
function sourceFor(
  session: UtopiaSession,
  kbId: string,
  existing: StoredUtopiaSource | null,
): Promise<UtopiaSource> {
  if (existing?.kbId === kbId) {
    return Promise.resolve({ id: existing.id, key: existing.key });
  }

  return session.createStatementsSource(kbId, "lore");
}
