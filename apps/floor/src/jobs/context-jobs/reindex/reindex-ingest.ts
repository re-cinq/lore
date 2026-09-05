// Per-file ingest primitives: resolve a repo's team schema, read its tree/changed files, and chunk+embed+store one file.

import { errorMessage } from "@re-cinq/lore-shared";
import { projectFor } from "../../../kernel/project-boot.js";
import { chunks, settings } from "../../../kernel/queues.js";
import {
  chunkFile,
  classifyFile,
  buildIngestedChunkMetadata,
  getQueryEmbedding,
} from "@re-cinq/lore-shared";

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

// ── Schema resolution ────────────────────────────────────────────────

export async function resolveSchema(repo: string): Promise<string> {
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

export async function getChangedFiles(
  fullName: string,
  since: Date,
): Promise<string[]> {
  const commits = await projectFor(fullName).then((p) =>
    p.repo.listCommitsSince(since.toISOString()),
  );

  const paths = new Set<string>(commits.flatMap((commit) => commit.files));

  return Array.from(paths);
}

export async function adoptLegacyOrgSharedChunks(
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

export async function ingestRepoFiles(
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

export async function getTree(fullName: string): Promise<string[]> {
  return projectFor(fullName).then((p) => p.repo.tree());
}

// ── Ingest a single file ────────────────────────────────────────────

/** Generate and store the embedding for one already-inserted chunk (input already capped at 8k in the service). */
async function embedAndStoreChunk(
  schema: string,
  filePath: string,
  chunk: { content: string; metadata: { chunk_index: unknown } },
  chunkId: string | null,
): Promise<void> {
  const embedding = await getQueryEmbedding(chunk.content);

  if (!chunkId) {
    return;
  }

  if (!embedding) {
    console.log(
      `[job] Ingested ${filePath} chunk ${chunk.metadata.chunk_index} without embedding (id ${chunkId})`,
    );

    return;
  }

  const embeddingStr = `[${embedding.join(",")}]`;

  await chunks().setEmbedding(schema, chunkId, embeddingStr);
  console.log(
    `[job] Embedded ${filePath} chunk ${chunk.metadata.chunk_index} (id ${chunkId})`,
  );
}

export async function ingestFile(
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

    await embedAndStoreChunk(schema, filePath, chunk, chunkId);
  }

  return true;
}
