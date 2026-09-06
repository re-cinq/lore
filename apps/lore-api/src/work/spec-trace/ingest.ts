import type { Pool } from "pg";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** Incremental file ingestion: fetches content from GitHub, classifies, upserts chunks, generates embeddings. */
import { getQueryEmbedding } from "@re-cinq/lore-server-core/platform/db.js";
import {
  chunkFile,
  classifyFile,
  buildIngestedChunkMetadata,
} from "@re-cinq/lore-shared";
import {
  resolveGithubFetchContext,
  resolveFileContent,
  type IngestFile,
  type GithubFetchContext,
} from "./ingest-github-fetch.js";

export type { IngestFile } from "./ingest-github-fetch.js";

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

interface IngestOneFileContext {
  pool: Pool;
  schema: string;
  repo: string;
  commit: string;
  githubCtx: GithubFetchContext | null;
}

async function ingestOneFile(
  ctx: IngestOneFileContext,
  fileEntry: IngestFile,
): Promise<IngestResult> {
  const { pool, schema, repo, commit, githubCtx } = ctx;
  const filePath = typeof fileEntry === "string" ? fileEntry : fileEntry.path;

  try {
    const { content, missing404 } = await resolveFileContent(
      fileEntry,
      githubCtx,
      filePath,
      commit,
    );

    if (missing404) {
      await pool.query(
        `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
        [filePath, repo],
      );

      return { file: filePath, status: "deleted" };
    }

    if (!content) {
      return {
        file: filePath,
        status: "skipped",
        error: "not a file (directory?)",
      };
    }

    const contentType = classifyFile(filePath);

    if (!contentType) {
      return {
        file: filePath,
        status: "skipped",
        error: "unsupported file type",
      };
    }

    await pool.query(
      `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
      [filePath, repo],
    );

    const chunks = await chunkFile(content, filePath, contentType);
    const { firstChunkId, embedded } = await insertChunksWithEmbeddings(
      pool,
      schema,
      { repo, filePath, commit, contentType },
      chunks,
    );

    return {
      file: filePath,
      status: "ingested",
      chunk_id: firstChunkId,
      embedded,
    };
  } catch (err) {
    console.error(`[ingest] Error processing ${filePath}:`, errorMessage(err));

    return { file: filePath, status: "error", error: errorMessage(err) };
  }
}

function tallyIngestResults(results: IngestResult[]): {
  ingested: number;
  deleted: number;
  errors: number;
} {
  return results.reduce(
    (counts, result) => {
      if (result.status === "ingested") {
        counts.ingested++;
      }

      if (result.status === "deleted") {
        counts.deleted++;
      }

      if (result.status === "error") {
        counts.errors++;
      }

      return counts;
    },
    { ingested: 0, deleted: 0, errors: 0 },
  );
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

  const githubCtx = await resolveGithubFetchContext(files, repo);
  const results: IngestResult[] = [];

  const fileCtx: IngestOneFileContext = {
    pool,
    schema,
    repo,
    commit,
    githubCtx,
  };

  for (const fileEntry of files) {
    results.push(await ingestOneFile(fileCtx, fileEntry));
  }

  const counts = tallyIngestResults(results);

  console.error(
    `[ingest] ${repo}@${commit.slice(0, 7)}: ${counts.ingested} ingested, ${counts.deleted} deleted, ${counts.errors} errors (schema: ${schema})`,
  );

  return { ...counts, schema, results };
}
