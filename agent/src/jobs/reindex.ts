import { query, getPool } from "../db.js";
import { platform } from "../platform.js";
import { chunkFile } from "@re-cinq/lore-shared";

interface OnboardedRepo {
  full_name: string;
  last_ingested_at: Date | null;
}

interface RepoTeam {
  team: string | null;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

const GCP_PROJECT = process.env.GCP_PROJECT || "";
const GCP_REGION = process.env.GCP_REGION || "europe-west1";
const VERTEX_MODEL = "text-embedding-005";

/** Default files to ingest for repos with no prior ingestion. */
const SEED_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "adrs/",
  ".specify/spec.md",
];

// ── File classification (mirrors mcp-server/src/ingest.ts) ──────────

function classifyFile(path: string): string | null {
  // Skip binary / non-textual files
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|lock)$/i.test(path)) return null;

  if (path.endsWith("CLAUDE.md") || path.endsWith("AGENTS.md") || path.endsWith("CODEOWNERS")) return "doc";
  if (/(?:^|\/)adrs\//.test(path)) return "adr";
  if (/(?:^|\/)specs\//.test(path) || path.startsWith(".specify/")) return "spec";
  if (/(?:^|\/)runbooks\//.test(path)) return "doc";
  if (/\.(ts|js|py|go|sh|rs|java|rb|kt|c|cpp|h|hpp)$/.test(path)) return "code";
  if (path.endsWith(".md") || path.endsWith(".yaml") || path.endsWith(".yml")) return "doc";
  return null; // skip unknown file types
}

// ── Schema resolution ────────────────────────────────────────────────

async function resolveSchema(repo: string): Promise<string> {
  try {
    const rows = await query<RepoTeam>(
      `SELECT team FROM lore.repos WHERE full_name = $1`,
      [repo],
    );
    const team = rows[0]?.team;
    if (team && SCHEMA_RE.test(team)) {
      // Verify schema exists in DB
      const schemaRows = await query<{ schema_name: string }>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [team],
      );
      if (schemaRows.length > 0) return team;
    }
  } catch (err) {
    console.error("[job] Schema resolution error:", err);
  }
  return "org_shared";
}

// ── Vertex AI embedding ─────────────────────────────────────────────

async function getAccessToken(): Promise<string | null> {
  // Try GKE metadata server first (Workload Identity)
  try {
    const metaRes = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    const metaJson = (await metaRes.json()) as { access_token: string };
    return metaJson.access_token;
  } catch {
    // Fall back to GOOGLE_ACCESS_TOKEN env var (local dev)
    const token = process.env.GOOGLE_ACCESS_TOKEN || "";
    return token || null;
  }
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const token = await getAccessToken();
  if (!token) {
    console.error("[job] No access token available for Vertex AI");
    return null;
  }

  try {
    const res = await fetch(
      `https://${GCP_REGION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${GCP_REGION}/publishers/google/models/${VERTEX_MODEL}:predict`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instances: [{ content: text.substring(0, 8000) }],
        }),
      },
    );

    if (!res.ok) {
      console.error(`[job] Vertex AI embedding failed: ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      predictions: Array<{ embeddings: { values: number[] } }>;
    };
    return json.predictions[0].embeddings.values;
  } catch (err) {
    console.error("[job] Vertex AI embedding error:", err);
    return null;
  }
}

// ── Collect changed files from commits ──────────────────────────────

async function getChangedFiles(
  fullName: string,
  since: Date,
): Promise<string[]> {
  const commits = await platform().listCommitsSince(fullName, since.toISOString());

  const paths = new Set<string>();
  for (const commit of commits) {
    for (const file of commit.files) {
      paths.add(file);
    }
  }
  return Array.from(paths);
}

// ── Seed files for first-time repos ─────────────────────────────────

async function getSeedFiles(fullName: string): Promise<string[]> {
  const paths: string[] = [];

  for (const seedPath of SEED_PATHS) {
    try {
      if (seedPath.endsWith("/")) {
        // Directory — list contents
        const dirPath = seedPath.replace(/\/$/, "");
        const entries = await platform().listDirectory(fullName, dirPath);
        for (const entry of entries) {
          paths.push(`${dirPath}/${entry}`);
        }
      } else {
        // Single file — check existence
        const content = await platform().getFileContent(fullName, seedPath);
        if (content !== null) {
          paths.push(seedPath);
        }
      }
    } catch {
      // File/dir doesn't exist, skip
    }
  }
  return paths;
}

// ── Ingest a single file ────────────────────────────────────────────

async function ingestFile(
  filePath: string,
  fullName: string,
  schema: string,
): Promise<boolean> {
  const pool = getPool();

  // Classify before fetching content
  const contentType = classifyFile(filePath);
  if (!contentType) {
    console.log(`[job] Skipping ${filePath} (unsupported type)`);
    return false;
  }

  // Fetch file content via platform
  const content = await platform().getFileContent(fullName, filePath);
  if (content === null) {
    // File was deleted or not found — remove existing chunks
    await pool.query(
      `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
      [filePath, fullName],
    );
    console.log(`[job] Deleted chunks for removed file ${filePath}`);
    return true;
  }

  // Delete existing chunks for this file
  await pool.query(
    `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
    [filePath, fullName],
  );

  // Chunk the file using AST-based chunking (code) or heading-based (docs)
  const chunks = await chunkFile(content, filePath, contentType);

  for (const chunk of chunks) {
    const { rows } = await pool.query(
      `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        chunk.content,
        contentType,
        schema,
        fullName,
        filePath,
        JSON.stringify({ ...chunk.metadata, file_path: filePath, ingested_by: "reindex-job" }),
      ],
    );

    const chunkId = rows[0]?.id;

    // Generate and store embedding per chunk (input already capped at 8k in generateEmbedding)
    const embedding = await generateEmbedding(chunk.content);
    if (embedding && chunkId) {
      const embeddingStr = `[${embedding.join(",")}]`;
      await pool.query(
        `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`,
        [embeddingStr, chunkId],
      );
      console.log(`[job] Embedded ${filePath} chunk ${chunk.metadata.chunk_index} (id ${chunkId})`);
    } else if (chunkId) {
      console.log(`[job] Ingested ${filePath} chunk ${chunk.metadata.chunk_index} without embedding (id ${chunkId})`);
    }
  }

  return true;
}

// ── Main job ─────────────────────────────────────────────────────────

export async function reindexJob(): Promise<string> {
  const repos = await query<OnboardedRepo>(
    `SELECT full_name, last_ingested_at
     FROM lore.repos
     WHERE onboarding_pr_merged = true`,
  );

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
        console.error(`[job] Invalid schema "${schema}" for ${repo.full_name}, skipping`);
        continue;
      }

      // Determine which files to process
      // If repo has zero chunks, always do a full seed (handles failed first ingestion)
      const chunkCount = await query<{ c: string }>(
        `SELECT count(*)::text as c FROM ${schema}.chunks WHERE repo = $1`, [repo.full_name],
      );
      const hasChunks = Number(chunkCount[0]?.c || 0) > 0;

      let filePaths: string[];
      if (repo.last_ingested_at && hasChunks) {
        filePaths = await getChangedFiles(repo.full_name, repo.last_ingested_at);
      } else {
        filePaths = await getSeedFiles(repo.full_name);
      }

      if (filePaths.length === 0) {
        console.log(`[job] No files to reindex for ${repo.full_name}`);
        // Still update timestamp so we don't re-check the same window
        await query(
          `UPDATE lore.repos SET last_ingested_at = now() WHERE full_name = $1`,
          [repo.full_name],
        );
        continue;
      }

      console.log(`[job] Processing ${filePaths.length} files for ${repo.full_name}`);

      let repoFileCount = 0;
      for (const filePath of filePaths) {
        try {
          const ingested = await ingestFile(filePath, repo.full_name, schema);
          if (ingested) repoFileCount++;
        } catch (err: any) {
          console.error(`[job] Error processing ${repo.full_name}:${filePath}: ${err.message}`);
        }
      }

      // Update last_ingested_at
      await query(
        `UPDATE lore.repos SET last_ingested_at = now() WHERE full_name = $1`,
        [repo.full_name],
      );

      totalFiles += repoFileCount;
      totalRepos++;
      console.log(`[job] Finished ${repo.full_name}: ${repoFileCount} files reindexed`);
    } catch (err: any) {
      console.error(`[job] Error reindexing ${repo.full_name}: ${err.message}`);
    }
  }

  const summary = `Reindexed ${totalFiles} files across ${totalRepos} repos`;
  console.log(`[job] ${summary}`);
  return summary;
}
