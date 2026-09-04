import type { Pool } from "pg";
import { errorMessage } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

/** Incremental file ingestion: fetches content from GitHub, classifies, upserts chunks, generates embeddings. */
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
  const source = await resolveFileSource(files, repo);
  const results: IngestResult[] = [];

  for (const fileEntry of files) {
    results.push(
      await ingestOneFile(pool, { schema, repo, commit, source }, fileEntry),
    );
  }
  const count = (status: IngestResult["status"]) =>
    results.filter((r) => r.status === status).length;
  const ingested = count("ingested");
  const deleted = count("deleted");
  const errors = count("error");

  console.error(
    `[ingest] ${repo}@${commit.slice(0, 7)}: ${ingested} ingested, ${deleted} deleted, ${errors} errors (schema: ${schema})`,
  );

  return { ingested, deleted, errors, schema, results };
}

interface FileSource {
  octokit?: Awaited<ReturnType<typeof getOctokit>>;
  owner: string;
  repoName: string;
}

/** GitHub access is only needed for path-only entries; a batch that carries its own content never touches the App. */
async function resolveFileSource(
  files: IngestFile[],
  repo: string,
): Promise<FileSource> {
  if (!files.some((f) => typeof f === "string")) {
    return { owner: "", repoName: "" };
  }
  enforceTrue(
    isConfigured(),
    Error,
    "GitHub App not configured — cannot fetch file content",
  );
  const [owner, repoName] = repo.split("/");

  return { octokit: await getOctokit(), owner, repoName };
}

/** One file's whole journey. Every outcome is a result row rather than a throw, so one bad file never costs the rest of the batch. */
async function ingestOneFile(
  pool: Pool,
  ctx: { schema: string; repo: string; commit: string; source: FileSource },
  fileEntry: IngestFile,
): Promise<IngestResult> {
  const filePath = typeof fileEntry === "string" ? fileEntry : fileEntry.path;
  const { schema, repo, commit, source } = ctx;

  try {
    // Content provided directly needs no GitHub fetch.
    const inlineContent =
      typeof fileEntry !== "string" && fileEntry.content
        ? fileEntry.content
        : null;
    const fetched = inlineContent
      ? null
      : await fetchFileWithHeadFallback(source.octokit!, {
          owner: source.owner,
          repoName: source.repoName,
          filePath,
          commit,
        });

    // A genuine 404 means the file is gone from the repo, so its chunks go too.
    if (fetched?.missing404) {
      await deleteChunks(pool, schema, filePath, repo);

      return { file: filePath, status: "deleted" };
    }
    const content = inlineContent ?? fetched?.content ?? null;

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
    // Upsert: the old chunks go before the new ones land, so a shrinking file cannot leave orphans.
    await deleteChunks(pool, schema, filePath, repo);
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

async function deleteChunks(
  pool: Pool,
  schema: string,
  filePath: string,
  repo: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
    [filePath, repo],
  );
}
