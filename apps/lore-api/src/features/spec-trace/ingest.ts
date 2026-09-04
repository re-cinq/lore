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

type FetchErrorOutcome = "retry" | "missing" | "throw";

/** Decides how to react to a failed ref fetch: retry the next ref, report the file missing, or rethrow. */
function classifyFetchError(
  status: number | undefined,
  ref: string,
  commit: string,
): FetchErrorOutcome {
  if (status !== 404) {
    return "throw";
  }

  return ref === commit && commit !== "HEAD" ? "retry" : "missing";
}

type GetContentEntry = Awaited<
  ReturnType<
    Awaited<ReturnType<typeof getOctokit>>["rest"]["repos"]["getContent"]
  >
>["data"];

function extractEntryContent(entry: GetContentEntry): string | null {
  return "content" in entry
    ? Buffer.from(entry.content, "base64").toString("utf-8")
    : null;
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

      return { content: extractEntryContent(entry), missing404: false };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const outcome = classifyFetchError(status, ref, target.commit);

      if (outcome === "retry") {
        continue;
      }

      if (outcome === "missing") {
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

interface GithubFetchContext {
  octokit: Awaited<ReturnType<typeof getOctokit>>;
  owner: string;
  repoName: string;
}

/** Resolves GitHub access only when the batch has path-based (non-inline) entries. */
async function resolveGithubFetchContext(
  files: IngestFile[],
  repo: string,
): Promise<GithubFetchContext | null> {
  if (!files.some((f) => typeof f === "string")) {
    return null;
  }

  enforceTrue(
    isConfigured(),
    Error,
    "GitHub App not configured — cannot fetch file content",
  );
  const octokit = await getOctokit();
  const [owner, repoName] = repo.split("/");

  return { octokit, owner, repoName };
}

/** Resolves a file's content: inline content wins, otherwise fetches from GitHub. */
async function resolveFileContent(
  fileEntry: IngestFile,
  githubCtx: GithubFetchContext | null,
  filePath: string,
  commit: string,
): Promise<{ content: string | null; missing404: boolean }> {
  const inlineContent =
    typeof fileEntry !== "string" && fileEntry.content
      ? fileEntry.content
      : null;

  if (inlineContent) {
    return { content: inlineContent, missing404: false };
  }

  return fetchFileWithHeadFallback(githubCtx!.octokit, {
    owner: githubCtx!.owner,
    repoName: githubCtx!.repoName,
    filePath,
    commit,
  });
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
