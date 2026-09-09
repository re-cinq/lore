import type { Pool } from "pg";
import { errorMessage, stripCoverageLinks } from "@re-cinq/lore-shared";
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

interface IngestedFileTarget {
  repo: string;
  filePath: string;
  commit: string;
  contentType: string;
}

interface IngestOneFileContext {
  pool: Pool;
  schema: string;
  repo: string;
  commit: string;
  githubCtx: GithubFetchContext | null;
}

export interface IngestCounts {
  ingested: number;
  deleted: number;
  errors: number;
}

export interface IngestFilesSummary extends IngestCounts {
  schema: string;
  results: IngestResult[];
}

export async function ingestFiles(
  pool: Pool,
  files: IngestFile[],
  repo: string,
  commit: string,
): Promise<IngestFilesSummary> {
  const schema = await resolveSchema(pool, repo);

  enforceTrue(SCHEMA_RE.test(schema), Error, `Invalid schema name: ${schema}`);

  const results = await ingestEach(files, {
    pool,
    schema,
    repo,
    commit,
    githubCtx: await resolveGithubFetchContext(files, repo),
  });
  const counts = tallyIngestResults(results);

  logIngestSummary(repo, commit, schema, counts);

  return { ...counts, schema, results };
}

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

/** Ingests each file IN ORDER rather than in parallel: they share one schema and one GitHub context, and a burst of concurrent embedding calls is what the 429 backoff exists to avoid. Each file's own failure is already contained by `ingestOneFile`. */
async function ingestEach(
  files: IngestFile[],
  fileCtx: IngestOneFileContext,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];

  for (const fileEntry of files) {
    results.push(await ingestOneFile(fileCtx, fileEntry));
  }

  return results;
}

async function ingestOneFile(
  ctx: IngestOneFileContext,
  fileEntry: IngestFile,
): Promise<IngestResult> {
  const { commit, githubCtx } = ctx;
  const filePath = typeof fileEntry === "string" ? fileEntry : fileEntry.path;

  try {
    const resolved = await resolveFileContent(
      fileEntry,
      githubCtx,
      filePath,
      commit,
    );

    return await ingestResolved(ctx, filePath, resolved);
  } catch (err) {
    console.error(`[ingest] Error processing ${filePath}:`, errorMessage(err));

    return { file: filePath, status: "error", error: errorMessage(err) };
  }
}

/** What a resolved file becomes. A 404 is a DELETION rather than a failure — the file was ingested once and is gone now, so its chunks go with it. */
async function ingestResolved(
  ctx: IngestOneFileContext,
  filePath: string,
  resolved: { content: string | null; missing404: boolean },
): Promise<IngestResult> {
  const { content } = resolved;

  if (resolved.missing404) {
    await deleteChunks(ctx, filePath);

    return { file: filePath, status: "deleted" };
  }

  if (!content) {
    return skippedResult(filePath, "not a file (directory?)");
  }
  const contentType = classifyFile(filePath);

  if (!contentType) {
    return skippedResult(filePath, "unsupported file type");
  }

  return replaceChunks(ctx, { filePath, content, contentType });
}

async function deleteChunks(
  ctx: IngestOneFileContext,
  filePath: string,
): Promise<void> {
  await ctx.pool.query(
    `DELETE FROM ${ctx.schema}.chunks WHERE file_path = $1 AND repo = $2`,
    [filePath, ctx.repo],
  );
}

/** Neither an unreadable path nor an unclassifiable one is a fault in this repo's content, so both are skipped rather than reported as errors. */
function skippedResult(filePath: string, error: string): IngestResult {
  return { file: filePath, status: "skipped", error };
}

/** Replaces a file's chunks — never appends. Re-ingesting must not leave the previous version's chunks searchable alongside the new ones, which is why the delete is unconditional rather than a diff. */
async function replaceChunks(
  ctx: IngestOneFileContext,
  file: { filePath: string; content: string; contentType: string },
): Promise<IngestResult> {
  const { pool, schema, repo, commit } = ctx;
  const { filePath, content, contentType } = file;

  await deleteChunks(ctx, filePath);

  const { firstChunkId, embedded } = await insertChunksWithEmbeddings(
    pool,
    schema,
    { repo, filePath, commit, contentType },
    await chunkFile(content, filePath, contentType),
  );

  return {
    file: filePath,
    status: "ingested",
    chunk_id: firstChunkId,
    embedded,
  };
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
    const chunkId = await insertChunk(pool, schema, target, chunk);

    firstChunkId ??= chunkId;

    if (chunkId && (await embedChunk(pool, schema, chunkId, chunk.content))) {
      embedded = true;
    }
  }

  return { firstChunkId, embedded };
}

/** Inserts one chunk and returns its id. */
async function insertChunk(
  pool: Pool,
  schema: string,
  target: IngestedFileTarget,
  chunk: Awaited<ReturnType<typeof chunkFile>>[number],
): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
    chunkInsertValues(schema, target, chunk),
  );

  return rows[0]?.id;
}

/** Metadata is stamped at insert so a chunk carries where it came from without a join — the search path reads it on every hit. */
function chunkInsertValues(
  schema: string,
  target: IngestedFileTarget,
  chunk: Awaited<ReturnType<typeof chunkFile>>[number],
): unknown[] {
  const metadata = buildIngestedChunkMetadata(chunk, {
    filePath: target.filePath,
    ingestedBy: "api",
    commit: target.commit,
  });

  return [
    chunk.content,
    target.contentType,
    schema,
    target.repo,
    target.filePath,
    JSON.stringify(metadata),
  ];
}

/** Embeds a chunk and stores the vector, reporting whether it landed. A separate UPDATE rather than part of the INSERT: embedding calls an external model, and a chunk that fails to embed is still worth having — it stays findable by keyword search. Only the first 8k characters are embedded, which is the model's own window — after the coverage-link groups are stripped, or a backfilled spec statement spends that window on test paths. */
async function embedChunk(
  pool: Pool,
  schema: string,
  chunkId: string,
  content: string,
): Promise<boolean> {
  const embedding = await getQueryEmbedding(
    stripCoverageLinks(content).substring(0, 8000),
  );

  if (!embedding) {
    return false;
  }

  await pool.query(
    `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`,
    [`[${embedding.join(",")}]`, chunkId],
  );

  return true;
}

/** "skipped" is deliberately uncounted — it is neither work done nor a fault worth reporting. */
function tallyIngestResults(results: IngestResult[]): IngestCounts {
  const count = (status: IngestResult["status"]) =>
    results.filter((result) => result.status === status).length;

  return {
    ingested: count("ingested"),
    deleted: count("deleted"),
    errors: count("error"),
  };
}

/** Goes to stderr rather than stdout: ingestion runs under CLI entry points whose stdout is a machine-read payload. */
function logIngestSummary(
  repo: string,
  commit: string,
  schema: string,
  counts: IngestCounts,
): void {
  console.error(
    `[ingest] ${repo}@${commit.slice(0, 7)}: ${counts.ingested} ingested, ${counts.deleted} deleted, ${counts.errors} errors (schema: ${schema})`,
  );
}
