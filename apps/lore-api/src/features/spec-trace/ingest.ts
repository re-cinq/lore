import type { Pool } from "pg";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/**
 * Incremental file ingestion module.
 *
 * Fetches file content from GitHub, classifies it, upserts into the
 * appropriate schema's chunks table, and generates Vertex AI embeddings.
 * Called by the /api/ingest HTTP endpoint when GitHub Actions pushes.
 */

import {
  getOctokit,
  isAppConfigured as isConfigured,
} from "../../platform/github-client.js";
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import {
  chunkFile,
  classifyFile,
  buildIngestedChunkMetadata,
} from "@re-cinq/lore-shared";

export interface IngestResult {
  file: string;
  status: "ingested" | "deleted" | "skipped" | "error";
  chunk_id?: string;
  embedded?: boolean;
  error?: string;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

async function resolveSchema(pool: Pool, repo: string): Promise<string> {
  try {
    const { rows } = await pool.query(
      `SELECT team FROM lore.repos WHERE full_name = $1`,
      [repo],
    );
    const team = rows[0]?.team;

    if (team && SCHEMA_RE.test(team)) {
      // Verify schema exists in DB
      const { rows: schemas } = await pool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [team],
      );

      return schemas.length > 0 ? team : "org_shared";
    }
  } catch (err) {
    console.error("[ingest] Schema resolution error:", err);
  }

  return "org_shared";
}

export type IngestFile = string | { path: string; content: string };

interface GitHubFileTarget {
  owner: string;
  repoName: string;
  filePath: string;
  commit: string;
}

/** Fetches file content at the commit, falling back to HEAD when the commit is unknown to the repo. */
async function fetchFileWithHeadFallback(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  target: GitHubFileTarget,
): Promise<{ content: string | null; missing404: boolean }> {
  for (const ref of [target.commit, "HEAD"]) {
    try {
      const { data: entry } = await octokit.rest.repos.getContent({
        owner: target.owner,
        repo: target.repoName,
        path: target.filePath,
        ref,
      });
      const content =
        "content" in entry
          ? Buffer.from(entry.content, "base64").toString("utf-8")
          : null;

      return { content, missing404: false };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const commitUnknownToRepo =
        status === 404 && ref === target.commit && target.commit !== "HEAD";

      if (commitUnknownToRepo) {
        continue;
      }

      if (status === 404) {
        return { content: null, missing404: true };
      }
      throw err;
    }
  }

  return { content: null, missing404: false };
}

interface IngestedFileTarget {
  repo: string;
  filePath: string;
  commit: string;
  contentType: string;
}

/** Inserts each chunk and its embedding (input capped at 8k chars as a safety net). */
async function insertChunksWithEmbeddings(
  pool: Pool,
  schema: string,
  target: IngestedFileTarget,
  chunks: Awaited<ReturnType<typeof chunkFile>>,
): Promise<{ firstChunkId: string | undefined; embedded: boolean }> {
  let firstChunkId: string | undefined;
  let embedded = false;

  for (const chunk of chunks) {
    const { rows } = await pool.query(
      `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        chunk.content,
        target.contentType,
        schema,
        target.repo,
        target.filePath,
        JSON.stringify(
          buildIngestedChunkMetadata(chunk, {
            filePath: target.filePath,
            ingestedBy: "api",
            commit: target.commit,
          }),
        ),
      ],
    );
    const chunkId = rows[0]?.id;

    if (!firstChunkId) {
      firstChunkId = chunkId;
    }
    const embedding = await getQueryEmbedding(chunk.content.substring(0, 8000));

    if (embedding && chunkId) {
      const embeddingStr = `[${embedding.join(",")}]`;

      await pool.query(
        `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`,
        [embeddingStr, chunkId],
      );
      embedded = true;
    }
  }

  return { firstChunkId, embedded };
}

export async function ingestFiles(
  pool: Pool,
  files: IngestFile[],
  repo: string,
  commit: string,
): Promise<{
  ingested: number;
  deleted: number;
  errors: number;
  schema: string;
  results: IngestResult[];
}> {
  const schema = await resolveSchema(pool, repo);

  enforceTrue(SCHEMA_RE.test(schema), Error, `Invalid schema name: ${schema}`);

  // Determine if we need GitHub access (only for path-based files)
  const needsGitHub = files.some((f) => typeof f === "string");
  let octokit: Awaited<ReturnType<typeof getOctokit>> | undefined;
  let owner = "";
  let repoName = "";

  if (needsGitHub) {
    enforceTrue(
      isConfigured(),
      Error,
      "GitHub App not configured — cannot fetch file content",
    );
    octokit = await getOctokit();
    [owner, repoName] = repo.split("/");
  }

  const results: IngestResult[] = [];
  let ingested = 0;
  let deleted = 0;
  let errors = 0;

  for (const fileEntry of files) {
    const filePath = typeof fileEntry === "string" ? fileEntry : fileEntry.path;

    try {
      // Content provided directly needs no GitHub fetch.
      const inlineContent =
        typeof fileEntry !== "string" && fileEntry.content
          ? fileEntry.content
          : null;
      const fetched = inlineContent
        ? null
        : await fetchFileWithHeadFallback(octokit!, {
            owner,
            repoName,
            filePath,
            commit,
          });

      if (fetched?.missing404) {
        // File genuinely doesn't exist — remove from chunks
        await pool.query(
          `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
          [filePath, repo],
        );
        results.push({ file: filePath, status: "deleted" });
        deleted++;
        continue;
      }
      const content = inlineContent ?? fetched?.content ?? null;

      if (!content) {
        results.push({
          file: filePath,
          status: "skipped",
          error: "not a file (directory?)",
        });
        continue;
      }

      const contentType = classifyFile(filePath);

      if (!contentType) {
        results.push({
          file: filePath,
          status: "skipped",
          error: "unsupported file type",
        });
        continue;
      }

      // Upsert: delete old chunks for this file
      await pool.query(
        `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
        [filePath, repo],
      );

      // Chunk the file using AST-based chunking (code) or heading-based (docs)
      const chunks = await chunkFile(content, filePath, contentType);
      const { firstChunkId, embedded } = await insertChunksWithEmbeddings(
        pool,
        schema,
        { repo, filePath, commit, contentType },
        chunks,
      );

      results.push({
        file: filePath,
        status: "ingested",
        chunk_id: firstChunkId,
        embedded,
      });
      ingested++;
    } catch (err) {
      console.error(
        `[ingest] Error processing ${filePath}:`,
        errorMessage(err),
      );
      results.push({
        file: filePath,
        status: "error",
        error: errorMessage(err),
      });
      errors++;
    }
  }

  console.error(
    `[ingest] ${repo}@${commit.slice(0, 7)}: ${ingested} ingested, ${deleted} deleted, ${errors} errors (schema: ${schema})`,
  );

  return { ingested, deleted, errors, schema, results };
}
