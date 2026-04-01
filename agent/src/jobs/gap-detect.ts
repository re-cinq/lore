import { query } from "../db.js";

interface OnboardedRepo {
  id: string;
  full_name: string;
  last_ingested_at: Date | null;
}

interface GapReport {
  repo: string;
  type: string;
  detail: string;
}

const LANGFUSE_PK = process.env.LANGFUSE_PK;
const LANGFUSE_SK = process.env.LANGFUSE_SK;
const LANGFUSE_HOST = process.env.LANGFUSE_HOST;
const STALE_DAYS = 90;

/**
 * Gap Detection Job
 *
 * Checks onboarded repos for missing or stale context:
 * 1. Missing CLAUDE.md (fixed: query content_type='doc' + file_path LIKE)
 * 2. Missing ADRs (repos with 0 adr chunks)
 * 3. Missing specs (active repos with 0 spec chunks)
 * 4. Stale content (chunks not re-ingested in >90 days)
 * 5. Low-confidence Langfuse traces (if configured)
 */
export async function gapDetectJob(): Promise<string> {
  const repos = await query<OnboardedRepo>(
    `SELECT id, full_name, last_ingested_at
     FROM lore.repos
     WHERE onboarding_pr_merged = true`,
  );

  const gaps: GapReport[] = [];

  for (const repo of repos) {
    try {
      await checkMissingClaudeMd(repo, gaps);
      await checkMissingAdrs(repo, gaps);
      await checkMissingSpecs(repo, gaps);
      await checkStaleContent(repo, gaps);
    } catch (err) {
      console.error(
        `[job] gap-detect: error checking ${repo.full_name}:`,
        err,
      );
    }
  }

  // Langfuse-driven gap detection (if configured)
  await checkLangfuseGaps(gaps);

  // Create pipeline tasks for each gap
  let created = 0;
  for (const gap of gaps) {
    try {
      const result = await query<{ id: string }>(
        `INSERT INTO pipeline.tasks (description, task_type, status, target_repo)
         VALUES ($1, 'gap-fill', 'pending', $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [`Gap: ${gap.type} — ${gap.detail}`, gap.repo],
      );
      if (result.length > 0) created++;
    } catch (err) {
      console.error(`[job] gap-detect: error creating task for ${gap.repo}:`, err);
    }
  }

  const summary = `Checked ${repos.length} repos, ${gaps.length} gaps detected, ${created} tasks created`;
  console.log(`[job] gap-detect: ${summary}`);
  return summary;
}

async function checkMissingClaudeMd(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const chunks = await query<{ id: string }>(
    `SELECT id FROM org_shared.chunks
     WHERE repo = $1
       AND content_type = 'doc'
       AND file_path LIKE '%CLAUDE.md'
     LIMIT 1`,
    [repo.full_name],
  );

  if (chunks.length === 0) {
    console.log(`[job] gap-detect: ${repo.full_name} missing CLAUDE.md`);
    gaps.push({
      repo: repo.full_name,
      type: "missing-claude-md",
      detail: `${repo.full_name} has no CLAUDE.md in context`,
    });
  }
}

async function checkMissingAdrs(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const chunks = await query<{ id: string }>(
    `SELECT id FROM org_shared.chunks
     WHERE repo = $1 AND content_type = 'adr'
     LIMIT 1`,
    [repo.full_name],
  );

  if (chunks.length === 0) {
    console.log(`[job] gap-detect: ${repo.full_name} has no ADRs`);
    gaps.push({
      repo: repo.full_name,
      type: "missing-adrs",
      detail: `${repo.full_name} has no architecture decision records`,
    });
  }
}

async function checkMissingSpecs(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const chunks = await query<{ id: string }>(
    `SELECT id FROM org_shared.chunks
     WHERE repo = $1 AND content_type = 'spec'
     LIMIT 1`,
    [repo.full_name],
  );

  if (chunks.length === 0) {
    console.log(`[job] gap-detect: ${repo.full_name} has no specs`);
    gaps.push({
      repo: repo.full_name,
      type: "missing-specs",
      detail: `${repo.full_name} has no spec files in context`,
    });
  }
}

async function checkStaleContent(
  repo: OnboardedRepo,
  gaps: GapReport[],
): Promise<void> {
  const stale = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM org_shared.chunks
     WHERE repo = $1
       AND ingested_at < NOW() - INTERVAL '${STALE_DAYS} days'`,
    [repo.full_name],
  );

  const staleCount = parseInt(stale[0]?.count || "0", 10);
  if (staleCount > 10) {
    console.log(
      `[job] gap-detect: ${repo.full_name} has ${staleCount} stale chunks (>${STALE_DAYS} days)`,
    );
    gaps.push({
      repo: repo.full_name,
      type: "stale-content",
      detail: `${repo.full_name} has ${staleCount} chunks not re-ingested in >${STALE_DAYS} days`,
    });
  }
}

async function checkLangfuseGaps(gaps: GapReport[]): Promise<void> {
  if (!LANGFUSE_PK || !LANGFUSE_SK || !LANGFUSE_HOST) {
    console.log("[job] gap-detect: Langfuse not configured, skipping trace analysis");
    return;
  }

  try {
    // Fetch recent low-confidence traces from Langfuse
    const response = await fetch(`${LANGFUSE_HOST}/api/public/traces?tags=low-confidence&limit=100`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${LANGFUSE_PK}:${LANGFUSE_SK}`).toString("base64")}`,
      },
    });

    if (!response.ok) {
      console.error(`[job] gap-detect: Langfuse API returned ${response.status}`);
      return;
    }

    const data = (await response.json()) as {
      data: Array<{
        id: string;
        metadata: { namespace?: string; query?: string; topScore?: number };
      }>;
    };

    if (!data.data || data.data.length === 0) {
      console.log("[job] gap-detect: no low-confidence traces found");
      return;
    }

    // Cluster traces by query similarity (simple: group by namespace + first 50 chars)
    const clusters = new Map<string, { count: number; queries: string[]; namespace: string }>();
    for (const trace of data.data) {
      const ns = trace.metadata?.namespace || "unknown";
      const q = trace.metadata?.query || "";
      const key = `${ns}:${q.substring(0, 50).toLowerCase().trim()}`;

      const cluster = clusters.get(key) || { count: 0, queries: [], namespace: ns };
      cluster.count++;
      if (cluster.queries.length < 5) cluster.queries.push(q);
      clusters.set(key, cluster);
    }

    // Create gap-fill tasks for clusters with 3+ occurrences
    for (const [key, cluster] of clusters) {
      if (cluster.count < 3) continue;

      const sampleQueries = cluster.queries.slice(0, 3).join("; ");
      console.log(
        `[job] gap-detect: low-confidence cluster "${key}" (${cluster.count} occurrences)`,
      );

      gaps.push({
        repo: cluster.namespace,
        type: "low-confidence-cluster",
        detail: `${cluster.count} low-confidence queries in namespace "${cluster.namespace}": ${sampleQueries}`,
      });
    }
  } catch (err) {
    console.error("[job] gap-detect: Langfuse trace analysis failed:", err);
    // Non-fatal — continue without Langfuse data
  }
}
