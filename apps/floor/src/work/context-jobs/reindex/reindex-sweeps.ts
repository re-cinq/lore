// The catch-up sweeps: files an earlier run chunked with an older chunker (#995), and files it never ingested at all (#999). Separate from reindex.ts, which owns the nightly pass itself.

import {
  classifyFile,
  errorMessage,
  CHUNKER_VERSION,
  type ChunksPort,
} from "@re-cinq/lore-shared";

/** One repo's index: the team schema its chunks live in, and the repo they came from. */
export interface IndexedRepo {
  schema: string;
  repo: string;
}

/** Per-run caps. Both sweeps are catch-up work behind the incremental pass, so they take a bounded bite each night rather than blocking it. */
export const HEAL_FILES_PER_RUN = 200;
export const BACKFILL_FILES_PER_RUN = 200;

/** Re-ingests one stale file, or PRUNES its chunks when the file no longer classifies — a file that has become unclassifiable (renamed to an unknown extension, say) would otherwise keep serving its old chunks forever. Per-file catch: one bad file must not end the pass. */
async function healOne(
  port: Pick<ChunksPort, "deleteChunksForFile">,
  { schema, repo }: IndexedRepo,
  filePath: string,
  ingest: (filePath: string) => Promise<boolean>,
): Promise<boolean> {
  try {
    if (await ingest(filePath)) {
      return true;
    }
    await port.deleteChunksForFile(schema, filePath, repo);
    console.log(
      `[job] Heal pruned chunks of unclassifiable ${repo}:${filePath}`,
    );
  } catch (err) {
    console.error(`[job] Heal error ${repo}:${filePath}: ${errorMessage(err)}`);
  }

  return false;
}

/** The repo a sweep walks and the team schema its chunks live in. */
export interface IndexedRepo {
  schema: string;
  repo: string;
}

export async function healStaleChunkerFiles(
  port: Pick<ChunksPort, "staleChunkerFiles" | "deleteChunksForFile">,
  { schema, repo }: IndexedRepo,
  alreadyProcessed: Set<string>,
  ingest: (filePath: string) => Promise<boolean>,
): Promise<number> {
  const staleFiles = (
    await port.staleChunkerFiles(
      schema,
      repo,
      CHUNKER_VERSION,
      HEAL_FILES_PER_RUN,
    )
  ).filter((filePath) => !alreadyProcessed.has(filePath));

  let healed = 0;

  for (const filePath of staleFiles) {
    if (await healOne(port, { schema, repo }, filePath, ingest)) {
      healed++;
    }
  }

  if (healed > 0) {
    console.log(
      `[job] Healed ${healed} pre-v${CHUNKER_VERSION}-chunker files for ${repo}`,
    );
  }

  return healed;
}

/** Files the repo has that the index does not. Sorted before slicing so the per-run cap walks the SAME order every run — an unsorted slice would re-offer a shuffling subset and never finish a large repo. */
async function missingFiles(
  port: Pick<ChunksPort, "chunkedFilePaths">,
  { schema, repo }: IndexedRepo,
  {
    treePaths,
    alreadyProcessed,
  }: { treePaths: string[]; alreadyProcessed: Set<string> },
): Promise<string[]> {
  const chunked = new Set(await port.chunkedFilePaths(schema, repo));

  return treePaths
    .filter(
      (path) =>
        classifyFile(path) !== null &&
        !chunked.has(path) &&
        !alreadyProcessed.has(path),
    )
    .sort()
    .slice(0, BACKFILL_FILES_PER_RUN);
}

/** Ingests each file, counting what landed. Per-file catch: a repo with one unparseable file must still index the rest, and the count is what the caller reports as progress. */
async function ingestEach(
  files: string[],
  repo: string,
  ingest: (filePath: string) => Promise<boolean>,
): Promise<number> {
  let done = 0;

  for (const filePath of files) {
    try {
      if (await ingest(filePath)) {
        done++;
      }
    } catch (err) {
      console.error(
        `[job] Backfill error ${repo}:${filePath}: ${errorMessage(err)}`,
      );
    }
  }

  return done;
}

/** Ingest tree files absent from chunks (issue #999: seed is docs-only, changed-file post-onboarding). */

export async function backfillUningestedFiles(
  port: Pick<ChunksPort, "chunkedFilePaths">,
  { schema, repo }: IndexedRepo,
  {
    treePaths,
    alreadyProcessed,
  }: { treePaths: string[]; alreadyProcessed: Set<string> },
  ingest: (filePath: string) => Promise<boolean>,
): Promise<number> {
  const missing = await missingFiles(
    port,
    { schema, repo },
    {
      treePaths,
      alreadyProcessed,
    },
  );

  const backfilled = await ingestEach(missing, repo, ingest);

  if (backfilled > 0) {
    console.log(
      `[job] Backfilled ${backfilled} never-ingested files for ${repo}`,
    );
  }

  return backfilled;
}
