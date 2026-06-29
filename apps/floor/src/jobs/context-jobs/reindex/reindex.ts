import { query, getPool } from "../../../kernel/db.js";
import { projectFor } from "../../../composition/project-boot.js";
import { chunkFile, classifyFile, buildIngestedChunkMetadata } from "@re-cinq/lore-shared";

interface OnboardedRepo {
  full_name: string;
  last_ingested_at: Date | null;
}

interface RepoTeam {
  team: string | null;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]+$/;

const GCP_REGION = process.env.GCP_REGION || "europe-west1";
const VERTEX_MODEL = "text-embedding-005";

// The agent/CronJob env sets no project var (gcpProject defaults to ""), so an
// empty project produced a malformed Vertex URL — `projects//locations` — and a
// 400. Resolve from env, then fall back to the GKE metadata server (the same
// source getAccessToken() already uses). Cached for the process lifetime.
let cachedProject: string | null = null;
async function getProjectId(): Promise<string> {
  if (cachedProject !== null) return cachedProject;
  const fromEnv = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (fromEnv) return (cachedProject = fromEnv);
  try {
    const res = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/project/project-id",
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (res.ok) return (cachedProject = (await res.text()).trim());
  } catch {
    // fall through to empty
  }
  return (cachedProject = "");
}

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
      (SEED_EXACT.has(path) || SEED_PREFIXES.some((prefix) => path.startsWith(prefix))),
  );
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
  const project = await getProjectId();
  if (!project) {
    console.error("[job] No GCP project resolved for Vertex AI (set GCP_PROJECT or run on GKE)");
    return null;
  }

  try {
    const res = await fetch(
      `https://${GCP_REGION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${GCP_REGION}/publishers/google/models/${VERTEX_MODEL}:predict`,
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
  const commits = await projectFor(fullName).then((p) => p.repo.listCommitsSince(since.toISOString()));

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
  const tree = await projectFor(fullName).then((p) => p.repo.tree());
  return selectSeedFiles(tree);
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
  const content = await projectFor(fullName).then((p) => p.repo.read(filePath));
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
        JSON.stringify(buildIngestedChunkMetadata(chunk, { filePath, ingestedBy: "reindex-job" })),
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
