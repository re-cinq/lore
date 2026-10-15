// Sets a repository up in Utopia: its knowledge base in the person's workspace, the Lore ontology and kind words in it, and the one statements source the ingest pushes through.

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

export interface UtopiaSetupInput {
  repo: string;
  workspaceId: string;
  /** What the repo's settings already hold, so a source set up before keeps its key. */
  existing: UtopiaMirrorSettings | null;
}

/** The settings block to store; the key inside it is the source's own and leaves the server only through the ingest push. */
export async function setUpRepoInUtopia(
  session: UtopiaSession,
  input: UtopiaSetupInput,
): Promise<UtopiaMirrorSettings> {
  const kbId = await knowledgeBaseFor(session, input.workspaceId, input.repo);

  await installOntology(session, kbId);
  const source = await sourceFor(session, kbId, input.existing);

  return {
    kb_id: kbId,
    source_id: source.id,
    source_key: source.key,
    ontology_version: LORE_ONTOLOGY_VERSION,
  };
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

/** A source set up before is kept with its key, since Utopia hands a source's key out once, at creation. */
function sourceFor(
  session: UtopiaSession,
  kbId: string,
  existing: UtopiaMirrorSettings | null,
): Promise<UtopiaSource> {
  if (existing && existing.kb_id === kbId) {
    return Promise.resolve({
      id: existing.source_id,
      key: existing.source_key,
    });
  }

  return session.createStatementsSource(kbId, "lore");
}
