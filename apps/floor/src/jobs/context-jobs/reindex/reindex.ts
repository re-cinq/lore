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

/** Root-level files and directory prefixes seeded for repos with no prior
 *  ingestion. Prefixes match recursively, so nested specs (`specs/<feature>/
 *  spec.md`) are covered — not just the flat `.specify/spec.md` convention. */
const SEED_EXACT = new Set(["CLAUDE.md", "AGENTS.md"]);
const SEED_PREFIXES = ["adrs/", "specs/", ".specify/"];

/** Audit rows cap the recorded pruned-path list so a mass prune (thousands of
 *  orphans after a restructure) cannot write a megabyte payload; the full
 *  count is always recorded. */
const AUDIT_PRUNED_PATHS_CAP = 500;

/** Per-repo, per-run cap on the chunker-upgrade heal sweep, so a version bump
 *  re-embeds the org's code chunks across a few nights instead of one giant
 *  run. Healed files stamp the current version and drop out of the query.
 *  A query cap, not a healed-count cap: stale files the changed-file loop
 *  already re-ingested this run occupy slots and are then skipped — the
 *  shortfall heals the next night. Intentional, to keep the query cheap. */
const HEAL_FILES_PER_RUN = 200;

/** Per-repo, per-run cap on the never-ingested backfill sweep (mirrors
 *  HEAL_FILES_PER_RUN), so onboarding a large repo — or closing issue #999's
 *  204-file gap — spreads the ingest+embed cost across nights. Backfilled
 *  files gain chunks and drop out of the tree-vs-chunks diff. */
export const BACKFILL_FILES_PER_RUN = 200;

/** Filters a full repo file tree down to the seed set: supported content
 *  types (per classifyFile) that live under a seed root. Pure — unit-tested
 *  in reindex-seed.test.ts. */
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

/** Re-ingest code files whose stored chunks predate the current
 * CHUNKER_VERSION, skipping files this run already processed. A file the
 * ingest declines (classifyFile no longer supports its path) has its chunks
 * deleted instead — no current ingest path would recreate them, and leaving
 * them would wedge the sweep's capped query on the same files every night.
 * Per-file failures are logged and skipped; returns files healed. Unit-tested
 * with the in-memory chunks double in reindex-heal.test.ts. */
export async function healStaleChunkerFiles(
  port: Pick<ChunksPort, "staleChunkerFiles" | "deleteChunksForFile">,
  schema: string,
  repo: string,
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

/** Ingest classifyFile-supported files present in the repo tree but absent
 * from the chunks table (issue #999: the full seed is docs-only and the
 * changed-file path only sees post-onboarding commits, so files that predate
 * ingestion — or fell through a commit-listing gap — never enter the DB, and
 * the chunker heal sweep only re-ingests files that already have chunks).
 * Absence is judged against ALL of the repo's chunks regardless of owner, so
 * api/ui-ingested files are never re-ingested. Sorted then capped, so an
 * oversized gap drains deterministically across nightly runs. Per-file
 * failures are logged and skipped; returns files backfilled. Unit-tested with
 * the in-memory chunks double in reindex-backfill.test.ts. */
export async function backfillUningestedFiles(
  port: Pick<ChunksPort, "chunkedFilePaths">,
  schema: string,
  repo: string,
  treePaths: string[],
  alreadyProcessed: Set<string>,
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
      // Resolve target schema
      const schema = await resolveSchema(repo.full_name);

      if (!SCHEMA_RE.test(schema)) {
        console.error(
          `[job] Invalid schema "${schema}" for ${repo.full_name}, skipping`,
        );
        continue;
      }

      // Relocate legacy org_shared rows into the resolved schema BEFORE the
      // chunk count below — a newly team-resolved repo must adopt its history
      // rather than read as empty and trigger a full re-seed. No-op when
      // clean; non-fatal like the verification pass.
      if (schema !== "org_shared") {
        await adoptLegacyOrgSharedChunks(schema, repo.full_name);
      }

      // Determine which files to process
      // If repo has zero chunks, always do a full seed (handles failed first ingestion)
      const hasChunks =
        (await chunks().countChunks(schema, repo.full_name)) > 0;

      let treePaths: string[] | null = null;
      const lastIngestedAt = hasChunks ? repo.last_ingested_at : null;

      if (!lastIngestedAt) {
        treePaths = await getTree(repo.full_name);
      }

      const filePaths = lastIngestedAt
        ? await getChangedFiles(repo.full_name, lastIngestedAt)
        : selectSeedFiles(treePaths ?? []);

      let repoFileCount = 0;

      const nothingToReindex = filePaths.length === 0;

      if (nothingToReindex) {
        console.log(`[job] No files to reindex for ${repo.full_name}`);
      }

      if (!nothingToReindex) {
        console.log(
          `[job] Processing ${filePaths.length} files for ${repo.full_name}`,
        );
        repoFileCount += await ingestRepoFiles(
          filePaths,
          repo.full_name,
          schema,
        );
      }

      // Chunker-upgrade heal: re-ingest code files whose stored chunks predate
      // CHUNKER_VERSION, so chunking fixes reach files that never change
      // (issue #995: pre-v2 chunks dropped test bodies and line ranges).
      // Non-fatal; the cap spreads the one-time re-embed across nights.
      try {
        repoFileCount += await healStaleChunkerFiles(
          chunks(),
          schema,
          repo.full_name,
          new Set(filePaths),
          (filePath) => ingestFile(filePath, repo.full_name, schema),
        );
      } catch (err) {
        console.error(
          `[job] Chunker heal sweep failed for ${repo.full_name}: ${errorMessage(err)}`,
        );
      }

      // Verification pass: re-stamp reindex-owned chunks whose files still
      // exist, prune orphans of deleted files. Non-fatal — staleness clears
      // on the next successful night.
      try {
        treePaths ??= await getTree(repo.full_name);
        const { touched, pruned, prunedFiles } = await verifyRepoChunks(
          chunks(),
          schema,
          repo.full_name,
          treePaths,
        );

        console.log(
          `[job] Verified ${repo.full_name}: ${touched} chunks re-stamped, ${pruned} orphaned chunks pruned`,
        );

        if (pruned > 0) {
          await writeAuditLog({
            event_type: "reindex_prune",
            repo: repo.full_name,
            payload: {
              schema,
              pruned_rows: pruned,
              file_count: prunedFiles.length,
              file_paths: prunedFiles.slice(0, AUDIT_PRUNED_PATHS_CAP),
              truncated: prunedFiles.length > AUDIT_PRUNED_PATHS_CAP,
            },
          }).catch((err) =>
            console.error(
              `[job] Prune audit write failed for ${repo.full_name}: ${errorMessage(err)}`,
            ),
          );
        }
      } catch (err) {
        console.error(
          `[job] Verification pass failed for ${repo.full_name}: ${errorMessage(err)}`,
        );
      }

      // Backfill sweep: ingest supported files present in the tree but absent
      // from the chunks table (issue #999). Non-fatal; the cap drains an
      // oversized gap across nights.
      try {
        treePaths ??= await getTree(repo.full_name);
        repoFileCount += await backfillUningestedFiles(
          chunks(),
          schema,
          repo.full_name,
          treePaths,
          new Set(filePaths),
          (filePath) => ingestFile(filePath, repo.full_name, schema),
        );
      } catch (err) {
        console.error(
          `[job] Backfill sweep failed for ${repo.full_name}: ${errorMessage(err)}`,
        );
      }

      // Update last_ingested_at
      await settings().markIngested(repo.full_name);

      totalFiles += repoFileCount;
      totalRepos++;
      console.log(
        `[job] Finished ${repo.full_name}: ${repoFileCount} files reindexed`,
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
