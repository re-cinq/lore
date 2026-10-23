// Sets a repository up in Utopia, as a person or as the Utopia person Lore acts as: its knowledge base in their workspace, and the Lore ontology and kind words in it. The sources the ingest pushes through are made by the mirrors, each the first time it pushes.

import {
  LORE_KIND_WORDS,
  LORE_ONTOLOGY_VERSION,
  loreOntologyTurtle,
} from "@re-cinq/lore-shared/lore-ontology.js";
import type { UtopiaMirrorSettings } from "@re-cinq/lore-shared/models/repo-settings.js";
import type { UtopiaSession } from "@re-cinq/lore-shared/utopia/utopia-client.js";
import type { Pool } from "pg";
import {
  saveUtopiaBase,
  saveUtopiaMirrorSettings,
} from "../../outbound/utopia-sources.js";

export interface UtopiaSetupInput {
  repo: string;
  workspaceId: string;
}

export async function setUpRepoInUtopia(
  session: UtopiaSession,
  input: UtopiaSetupInput,
): Promise<UtopiaMirrorSettings> {
  const kbId = await knowledgeBaseFor(session, input.workspaceId, input.repo);

  await installOntology(session, kbId);

  return { kb_id: kbId, ontology_version: LORE_ONTOLOGY_VERSION };
}

/** The base first, to lore.utopia_bases, which a base with no repo row is found by, then the repo's settings, which gate its mirror. */
export async function storeUtopiaSetup(
  pool: Pool,
  repo: string,
  settings: UtopiaMirrorSettings,
): Promise<void> {
  await saveUtopiaBase(pool, repo, settings.kb_id);
  await saveUtopiaMirrorSettings(pool, repo, settings);
}

/** Idempotent on Utopia's side: a re-import of the same turtle plans no change, and a kind word bound again stays bound. A base set up under an older ontology is upgraded the same way. */
export async function installOntology(
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
