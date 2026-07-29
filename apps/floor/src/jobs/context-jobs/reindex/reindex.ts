import { errorMessage } from "@re-cinq/lore-shared";
import { projectFor } from "../../../composition/project-boot.js";
import { chunks, settings } from "../../../kernel/queues.js";
import {
  chunkFile,
  classifyFile,
  buildIngestedChunkMetadata,
  getQueryEmbedding,
} from "@re-cinq/lore-shared";
import { verifyRepoChunks } from "./verify.js";

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

/** Root-level files and directory prefixes seeded for repos with no prior
 *  ingestion. Prefixes match recursively, so nested specs (`specs/<feature>/
 *  spec.md`) are covered — not just the flat `.specify/spec.md` convention. */
const SEED_EXACT = new Set(["CLAUDE.md", "AGENTS.md"]);
const SEED_PREFIXES = ["adrs/", "specs/", ".specify/"];

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

    if (team && SCHEMA_RE.test(team)) {
      // Verify schema exists in DB
      if (await chunks().schemaExists(team)) {
        return team;
      }
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

  const paths = new Set<string>();

  for (const commit of commits) {
    for (const file of commit.files) {
      paths.add(file);
    }
  }

  return Array.from(paths);
}

// ── Repo tree fetch (seed selection + verification pass) ────────────

async function getTree(fullName: string): Promise<string[]> {
  return projectFor(fullName).then((p) => p.repo.tree());
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
    } else if (chunkId) {
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

      // Determine which files to process
      // If repo has zero chunks, always do a full seed (handles failed first ingestion)
      const hasChunks =
        (await chunks().countChunks(schema, repo.full_name)) > 0;

      let filePaths: string[];
      let treePaths: string[] | null = null;

      if (repo.last_ingested_at && hasChunks) {
        filePaths = await getChangedFiles(
          repo.full_name,
          repo.last_ingested_at,
        );
      } else {
        treePaths = await getTree(repo.full_name);
        filePaths = selectSeedFiles(treePaths);
      }

      let repoFileCount = 0;

      if (filePaths.length === 0) {
        console.log(`[job] No files to reindex for ${repo.full_name}`);
      } else {
        console.log(
          `[job] Processing ${filePaths.length} files for ${repo.full_name}`,
        );

        for (const filePath of filePaths) {
          try {
            const ingested = await ingestFile(filePath, repo.full_name, schema);

            if (ingested) {
              repoFileCount++;
            }
          } catch (err) {
            console.error(
              `[job] Error processing ${repo.full_name}:${filePath}: ${errorMessage(err)}`,
            );
          }
        }
      }

      // Verification pass: re-stamp reindex-owned chunks whose files still
      // exist, prune orphans of deleted files. Non-fatal — staleness clears
      // on the next successful night.
      try {
        treePaths ??= await getTree(repo.full_name);
        const { touched, pruned } = await verifyRepoChunks(
          chunks(),
          schema,
          repo.full_name,
          treePaths,
        );

        console.log(
          `[job] Verified ${repo.full_name}: ${touched} chunks re-stamped, ${pruned} orphaned chunks pruned`,
        );
      } catch (err) {
        console.error(
          `[job] Verification pass failed for ${repo.full_name}: ${errorMessage(err)}`,
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
