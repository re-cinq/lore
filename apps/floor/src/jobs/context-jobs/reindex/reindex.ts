import { errorMessage } from "@re-cinq/lore-shared";
import { projectFor } from "../../../composition/project-boot.js";
import { chunks, settings } from "../../../kernel/queues.js";
import { writeAuditLog } from "../../lib/audit.js";
import {
  chunkFile,
  classifyFile,
  buildIngestedChunkMetadata,
  getQueryEmbedding,
  CHUNKER_VERSION,
  type ChunksPort,
} from "@re-cinq/lore-shared";
import { verifyRepoChunks } from "./verify.js";

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

/** Root-level files and directory prefixes seeded for repos with no prior ingestion. */
const SEED_EXACT = new Set(["CLAUDE.md", "AGENTS.md"]);
const SEED_PREFIXES = ["adrs/", "specs/", ".specify/"];

/** Audit rows cap the recorded pruned-path list to prevent megabyte payloads. */
const AUDIT_PRUNED_PATHS_CAP = 500;

/** Per-repo, per-run cap on chunker-upgrade heal sweep to spread re-embed across nights. */
const HEAL_FILES_PER_RUN = 200;

/** Per-repo, per-run cap on never-ingested backfill sweep (mirrors HEAL_FILES_PER_RUN). */
export const BACKFILL_FILES_PER_RUN = 200;

/** Filters repo tree to seed set: supported types under seed roots (unit-tested in reindex-seed.test.ts). */
export function selectSeedFiles(treePaths: string[]): string[] {
  return treePaths.filter(
    (path) =>
      classifyFile(path) !== null &&
      (SEED_EXACT.has(path) ||
        SEED_PREFIXES.some((prefix) => path.startsWith(prefix))),
  );
}

// ── Schema resolution ────────────────────────────────────────────────

async function resolveSchema(repo: string): Promise<string> {
  try {
    const team = await settings().team(repo);

    if (!team || !SCHEMA_RE.test(team)) {
      return "org_shared";
    }

    // Verify schema exists in DB
    if (await chunks().schemaExists(team)) {
      return team;
    }
  } catch (err) {
    console.error("[job] Schema resolution error:", err);
  }

  return "org_shared";
}

// ── Collect changed files from commits ──────────────────────────────

async function getChangedFiles(
  fullName: string,
  since: Date,
): Promise<string[]> {
  const commits = await projectFor(fullName).then((p) =>
    p.repo.listCommitsSince(since.toISOString()),
  );

  const paths = new Set<string>(commits.flatMap((commit) => commit.files));

  return Array.from(paths);
}

async function adoptLegacyOrgSharedChunks(
  schema: string,
  fullName: string,
): Promise<void> {
  try {
    const { moved, dropped } = await chunks().relocateLegacyChunks(
      schema,
      fullName,
    );

    if (dropped > 0) {
      console.log(
        `[job] Relocated ${moved} legacy org_shared chunks into ${schema} for ${fullName} (${dropped - moved} stale duplicates dropped)`,
      );
    }
  } catch (err) {
    console.error(
      `[job] Legacy chunk relocation failed for ${fullName}: ${errorMessage(err)}`,
    );
  }
}

async function ingestRepoFiles(
  filePaths: string[],
  fullName: string,
  schema: string,
): Promise<number> {
  let ingestedCount = 0;

  for (const filePath of filePaths) {
    try {
      const ingested = await ingestFile(filePath, fullName, schema);

      if (ingested) {
        ingestedCount++;
      }
    } catch (err) {
      console.error(
        `[job] Error processing ${fullName}:${filePath}: ${errorMessage(err)}`,
      );
    }
  }

  return ingestedCount;
}

// ── Repo tree fetch (seed selection + verification pass) ────────────

async function getTree(fullName: string): Promise<string[]> {
  return projectFor(fullName).then((p) => p.repo.tree());
}

// ── Chunker-upgrade heal sweep ──────────────────────────────────────

/** Re-ingest code files pre-dating CHUNKER_VERSION; delete chunks for reclassified files. */

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
    try {
      if (await ingest(filePath)) {
        healed++;
        continue;
      }
      await port.deleteChunksForFile(schema, filePath, repo);
      console.log(
        `[job] Heal pruned chunks of unclassifiable ${repo}:${filePath}`,
      );
    } catch (err) {
      console.error(
        `[job] Heal error ${repo}:${filePath}: ${errorMessage(err)}`,
      );
    }
  }

  if (healed > 0) {
    console.log(
      `[job] Healed ${healed} pre-v${CHUNKER_VERSION}-chunker files for ${repo}`,
    );
  }

  return healed;
}

// ── Never-ingested backfill sweep ───────────────────────────────────

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
  const chunked = new Set(await port.chunkedFilePaths(schema, repo));
  const missing = treePaths
    .filter(
      (path) =>
        classifyFile(path) !== null &&
        !chunked.has(path) &&
        !alreadyProcessed.has(path),
    )
    .sort()
    .slice(0, BACKFILL_FILES_PER_RUN);

  let backfilled = 0;

  for (const filePath of missing) {
    try {
      if (await ingest(filePath)) {
        backfilled++;
      }
    } catch (err) {
      console.error(
        `[job] Backfill error ${repo}:${filePath}: ${errorMessage(err)}`,
      );
    }
  }

  if (backfilled > 0) {
    console.log(
      `[job] Backfilled ${backfilled} never-ingested files for ${repo}`,
    );
  }

  return backfilled;
}

// ── Ingest a single file ────────────────────────────────────────────

async function ingestFile(
  filePath: string,
  fullName: string,
  schema: string,
): Promise<boolean> {
  // Classify before fetching content
  const contentType = classifyFile(filePath);

  if (!contentType) {
    console.log(`[job] Skipping ${filePath} (unsupported type)`);

    return false;
  }

  // Fetch file content via platform
  const content = await projectFor(fullName).then((p) => p.repo.read(filePath));

  if (content === null) {
    // File was deleted or not found — remove existing chunks
    await chunks().deleteChunksForFile(schema, filePath, fullName);
    console.log(`[job] Deleted chunks for removed file ${filePath}`);

    return true;
  }

  // Delete existing chunks for this file
  await chunks().deleteChunksForFile(schema, filePath, fullName);

  // Chunk the file using AST-based chunking (code) or heading-based (docs)
  const fileChunks = await chunkFile(content, filePath, contentType);

  for (const chunk of fileChunks) {
    const chunkId = await chunks().insertChunk(schema, {
      content: chunk.content,
      contentType,
      team: schema,
      repo: fullName,
      filePath,
      metadata: buildIngestedChunkMetadata(chunk, {
        filePath,
        ingestedBy: "reindex-job",
      }),
    });

    // Generate and store embedding per chunk (input already capped at 8k in the service)
    const embedding = await getQueryEmbedding(chunk.content);

    if (embedding && chunkId) {
      const embeddingStr = `[${embedding.join(",")}]`;

      await chunks().setEmbedding(schema, chunkId, embeddingStr);
      console.log(
        `[job] Embedded ${filePath} chunk ${chunk.metadata.chunk_index} (id ${chunkId})`,
      );

      continue;
    }

    if (chunkId) {
      console.log(
        `[job] Ingested ${filePath} chunk ${chunk.metadata.chunk_index} without embedding (id ${chunkId})`,
      );
    }
  }

  return true;
}

// ── Main job ─────────────────────────────────────────────────────────

/** One repo's reindex, or null when it has no usable schema. Every sweep below is independently fail-soft: a repo keeps whatever the earlier passes ingested. */
async function reindexRepo(repo: {
  full_name: string;
  last_ingested_at: Date | null;
}): Promise<number | null> {
  const schema = await resolveSchema(repo.full_name);

  if (!SCHEMA_RE.test(schema)) {
    console.error(
      `[job] Invalid schema "${schema}" for ${repo.full_name}, skipping`,
    );

    return null;
  }

  // Relocate legacy org_shared rows into the resolved schema before chunk count.
  if (schema !== "org_shared") {
    await adoptLegacyOrgSharedChunks(schema, repo.full_name);
  }
  const target = { schema, repo: repo.full_name };
  // Zero chunks means the first ingestion failed, so the incremental window is meaningless — seed the whole repo instead.
  const hasChunks = (await chunks().countChunks(schema, repo.full_name)) > 0;
  const lastIngestedAt = hasChunks ? repo.last_ingested_at : null;
  let treePaths: string[] | null = lastIngestedAt
    ? null
    : await getTree(repo.full_name);
  const filePaths = lastIngestedAt
    ? await getChangedFiles(repo.full_name, lastIngestedAt)
    : selectSeedFiles(treePaths ?? []);
  const ingest = (filePath: string) =>
    ingestFile(filePath, repo.full_name, schema);
  let fileCount = 0;

  if (filePaths.length === 0) {
    console.log(`[job] No files to reindex for ${repo.full_name}`);
  }

  if (filePaths.length > 0) {
    console.log(
      `[job] Processing ${filePaths.length} files for ${repo.full_name}`,
    );
    fileCount += await ingestRepoFiles(filePaths, repo.full_name, schema);
  }
  const processed = new Set(filePaths);

  // Chunker-upgrade heal: re-ingest code files for fix in issue #995.
  fileCount += await sweep(repo.full_name, "Chunker heal sweep", () =>
    healStaleChunkerFiles(chunks(), target, processed, ingest),
  );
  // Verification pass: re-stamp chunks and prune orphans of deleted files.
  await sweep(repo.full_name, "Verification pass", async () => {
    treePaths ??= await getTree(repo.full_name);

    return await verifyChunks(target, treePaths);
  });
  // Backfill sweep: ingest never-ingested files (issue #999).
  fileCount += await sweep(repo.full_name, "Backfill sweep", async () => {
    treePaths ??= await getTree(repo.full_name);

    return await backfillUningestedFiles(
      chunks(),
      target,
      { treePaths, alreadyProcessed: processed },
      ingest,
    );
  });
  await settings().markIngested(repo.full_name);

  return fileCount;
}

/** One optional pass. A sweep that throws costs its own contribution and nothing else — the repo keeps what the passes before it ingested. */
async function sweep(
  repo: string,
  name: string,
  run: () => Promise<number | void>,
): Promise<number> {
  try {
    return (await run()) ?? 0;
  } catch (err) {
    console.error(`[job] ${name} failed for ${repo}: ${errorMessage(err)}`);

    return 0;
  }
}

/** Re-stamp what is still there and prune what is not, recording a pruned sweep in the audit log. */
async function verifyChunks(
  target: { schema: string; repo: string },
  treePaths: string[],
): Promise<void> {
  const { touched, pruned, prunedFiles } = await verifyRepoChunks(
    chunks(),
    target.schema,
    target.repo,
    treePaths,
  );

  console.log(
    `[job] Verified ${target.repo}: ${touched} chunks re-stamped, ${pruned} orphaned chunks pruned`,
  );

  if (pruned === 0) {
    return;
  }
  await writeAuditLog({
    event_type: "reindex_prune",
    repo: target.repo,
    payload: {
      schema: target.schema,
      pruned_rows: pruned,
      file_count: prunedFiles.length,
      file_paths: prunedFiles.slice(0, AUDIT_PRUNED_PATHS_CAP),
      truncated: prunedFiles.length > AUDIT_PRUNED_PATHS_CAP,
    },
  }).catch((err) =>
    console.error(
      `[job] Prune audit write failed for ${target.repo}: ${errorMessage(err)}`,
    ),
  );
}

export async function reindexJob(): Promise<string> {
  const repos = await settings().onboardedRepos();

  if (repos.length === 0) {
    console.log("[job] No onboarded repos to reindex");

    return "No onboarded repos to reindex";
  }

  let totalFiles = 0;
  let totalRepos = 0;

  for (const repo of repos) {
    console.log(
      `[job] Reindexing ${repo.full_name} (last ingested: ${repo.last_ingested_at?.toISOString() ?? "never"})`,
    );

    try {
      const fileCount = await reindexRepo(repo);

      if (fileCount === null) {
        continue;
      }
      totalFiles += fileCount;
      totalRepos++;
      console.log(
        `[job] Finished ${repo.full_name}: ${fileCount} files reindexed`,
      );
    } catch (err) {
      console.error(
        `[job] Error reindexing ${repo.full_name}: ${errorMessage(err)}`,
      );
    }
  }
  const summary = `Reindexed ${totalFiles} files across ${totalRepos} repos`;

  console.log(`[job] ${summary}`);

  return summary;
}
