import { execFile } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { query } from "../db.js";
import { callLLM } from "../anthropic.js";
import { platform } from "../platform.js";

const execFileAsync = promisify(execFile);

const LANGFUSE_PK = process.env.LANGFUSE_PK;
const LANGFUSE_SK = process.env.LANGFUSE_SK;
const LANGFUSE_HOST = process.env.LANGFUSE_HOST;

const MIN_CLUSTER_SIZE = 3;
const HALLUCINATION_WEIGHT = 3;
const TOP_CLUSTERS = 5;
const CANDIDATES_PER_CLUSTER = 3;
const IMPROVEMENT_THRESHOLD = 0.02; // 2%

interface TraceData {
  id: string;
  query: string;
  namespace: string;
  topScore: number;
  isHallucination: boolean;
}

interface Cluster {
  key: string;
  namespace: string;
  queries: string[];
  score: number; // weighted impact score
}

interface Candidate {
  approach: string; // "direct" | "example" | "constraint"
  content: string;
  evalScore: number;
  delta: number;
}

/**
 * Autoresearch Loop
 *
 * Runs weekly (Monday 6am UTC). Full pipeline:
 * 1. Query Langfuse for low-confidence + hallucination traces (7 days)
 * 2. Cluster by semantic similarity (simple: namespace + query prefix)
 * 3. Rank clusters by impact (hallucination=3x, recency, cross-namespace)
 * 4. For top-5 clusters, generate 3 candidate approaches each
 * 5. Evaluate each candidate via PromptFoo
 * 6. Best candidate >= 2% improvement → open PR; otherwise → log + create task
 */
export async function autoresearchJob(): Promise<string> {
  if (!LANGFUSE_PK || !LANGFUSE_SK || !LANGFUSE_HOST) {
    console.log("[job] autoresearch: Langfuse not configured, skipping");
    return "Skipped: no Langfuse";
  }

  // Step 1: Fetch low-confidence traces
  const traces = await fetchLowConfidenceTraces();
  if (traces.length === 0) {
    console.log("[job] autoresearch: no low-confidence traces found");
    return "No gaps detected";
  }

  // Step 2: Cluster traces
  const clusters = clusterTraces(traces);
  console.log(`[job] autoresearch: ${clusters.length} clusters from ${traces.length} traces`);

  if (clusters.length === 0) {
    return "No clusters met minimum size threshold";
  }

  // Step 3: Rank and take top N
  const topClusters = clusters
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CLUSTERS);

  let prsOpened = 0;
  let tasksCreated = 0;

  // Step 4-6: For each cluster, generate candidates, eval, act
  for (const cluster of topClusters) {
    try {
      const result = await processCluster(cluster);
      if (result === "pr") prsOpened++;
      else if (result === "task") tasksCreated++;
    } catch (err) {
      console.error(`[job] autoresearch: error processing cluster "${cluster.key}":`, err);
    }
  }

  const summary = `Processed ${topClusters.length} clusters: ${prsOpened} PRs opened, ${tasksCreated} tasks created`;
  console.log(`[job] autoresearch: ${summary}`);
  return summary;
}

async function fetchLowConfidenceTraces(): Promise<TraceData[]> {
  const traces: TraceData[] = [];

  // Fetch low-confidence traces
  try {
    const lcRes = await fetch(
      `${LANGFUSE_HOST}/api/public/traces?tags=low-confidence&limit=200`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${LANGFUSE_PK}:${LANGFUSE_SK}`).toString("base64")}`,
        },
      },
    );

    if (lcRes.ok) {
      const data = (await lcRes.json()) as {
        data: Array<{
          id: string;
          metadata: { namespace?: string; query?: string; topScore?: number };
          tags?: string[];
        }>;
      };

      for (const t of data.data || []) {
        traces.push({
          id: t.id,
          query: t.metadata?.query || "",
          namespace: t.metadata?.namespace || "unknown",
          topScore: t.metadata?.topScore || 0,
          isHallucination: (t.tags || []).includes("hallucination-detected"),
        });
      }
    }
  } catch (err) {
    console.error("[job] autoresearch: failed to fetch Langfuse traces:", err);
  }

  return traces;
}

function clusterTraces(traces: TraceData[]): Cluster[] {
  const clusterMap = new Map<string, { namespace: string; queries: string[]; hallucinationCount: number }>();

  for (const trace of traces) {
    // Simple clustering: namespace + first 50 chars of query
    const key = `${trace.namespace}:${trace.query.substring(0, 50).toLowerCase().trim()}`;
    const cluster = clusterMap.get(key) || {
      namespace: trace.namespace,
      queries: [],
      hallucinationCount: 0,
    };

    cluster.queries.push(trace.query);
    if (trace.isHallucination) cluster.hallucinationCount++;
    clusterMap.set(key, cluster);
  }

  // Filter by minimum size and compute impact score
  const clusters: Cluster[] = [];
  for (const [key, data] of clusterMap) {
    if (data.queries.length < MIN_CLUSTER_SIZE) continue;

    // Impact score: regular queries count 1, hallucinations count 3x
    const score =
      (data.queries.length - data.hallucinationCount) +
      data.hallucinationCount * HALLUCINATION_WEIGHT;

    clusters.push({
      key,
      namespace: data.namespace,
      queries: data.queries,
      score,
    });
  }

  return clusters;
}

async function processCluster(cluster: Cluster): Promise<"pr" | "task" | "skip"> {
  const sampleQueries = cluster.queries.slice(0, 5).join("\n- ");

  // Generate 3 candidate approaches via LLM
  const candidates: Candidate[] = [];
  const approaches = ["direct", "example", "constraint"] as const;

  for (const approach of approaches) {
    try {
      const content = await generateCandidate(cluster.namespace, sampleQueries, approach);

      // Evaluate candidate
      const evalScore = await evaluateCandidate(cluster.namespace, content);
      const baseScore = await getBaselineScore(cluster.namespace);
      const delta = evalScore - baseScore;

      candidates.push({ approach, content, evalScore, delta });

      console.log(
        `[job] autoresearch: ${cluster.key} ${approach}: score=${(evalScore * 100).toFixed(1)}% delta=${(delta * 100).toFixed(1)}%`,
      );

      // Log attempt to DB
      await query(
        `INSERT INTO pipeline.research_attempts (cluster_id, namespace, approach, content, eval_score, delta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cluster.key, cluster.namespace, approach, content, evalScore, delta],
      );
    } catch (err) {
      console.error(`[job] autoresearch: candidate generation failed for ${approach}:`, err);
    }
  }

  if (candidates.length === 0) return "skip";

  // Find best candidate
  const best = candidates.reduce((a, b) => (a.delta > b.delta ? a : b));

  if (best.delta >= IMPROVEMENT_THRESHOLD) {
    // Open PR with best candidate
    await openResearchPR(cluster, best, candidates);
    return "pr";
  } else {
    // Create pipeline task for manual review
    await query(
      `INSERT INTO pipeline.tasks (description, task_type, status, target_repo, context_bundle)
       VALUES ($1, 'gap-fill', 'pending', $2, $3)
       ON CONFLICT DO NOTHING`,
      [
        `Autoresearch: manual review needed for "${cluster.key}" (best delta: ${(best.delta * 100).toFixed(1)}%)`,
        cluster.namespace,
        JSON.stringify({
          cluster_key: cluster.key,
          sample_queries: cluster.queries.slice(0, 5),
          candidates: candidates.map((c) => ({
            approach: c.approach,
            delta: c.delta,
            evalScore: c.evalScore,
          })),
        }),
      ],
    );
    return "task";
  }
}

async function generateCandidate(
  namespace: string,
  sampleQueries: string,
  approach: "direct" | "example" | "constraint",
): Promise<string> {
  const prompts: Record<string, string> = {
    direct: `Generate a clear, direct statement that answers these questions for the "${namespace}" team. Write a rule or convention that would prevent these knowledge gaps:

Questions that developers couldn't answer:
- ${sampleQueries}

Write a concise paragraph (under 200 words) that directly states the answer.`,

    example: `Generate a code example that demonstrates the correct approach for these questions in the "${namespace}" team:

Questions that developers couldn't answer:
- ${sampleQueries}

Write a short code example with a brief explanation (under 300 words total).`,

    constraint: `Generate a constraint-based explanation for the "${namespace}" team — explain what NOT to do and why:

Questions that developers couldn't answer:
- ${sampleQueries}

Write a concise "don't do X because Y, instead do Z" explanation (under 200 words).`,
  };

  const result = await callLLM({
    prompt: prompts[approach],
    systemPrompt:
      "You generate context additions for developer knowledge bases. Be specific, testable, and concise. Never generate PII, credentials, or speculative content.",
    jobName: "autoresearch",
  });

  return result.text;
}

async function evaluateCandidate(
  namespace: string,
  candidateContent: string,
): Promise<number> {
  // Run PromptFoo eval with the candidate content injected
  const configPath = join("evals", namespace, "promptfooconfig.yaml");

  try {
    // Write candidate to temp file for injection
    const tmpDir = await mkdtemp(join(tmpdir(), "autoresearch-"));
    const candidatePath = join(tmpDir, "candidate.txt");
    await writeFile(candidatePath, candidateContent);

    const { stdout } = await execFileAsync(
      "npx",
      [
        "promptfoo", "eval",
        "--config", configPath,
        "--output", "json",
        "--no-progress-bar",
        "--env", `CANDIDATE_CONTEXT=${candidatePath}`,
      ],
      { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 },
    );

    await rm(tmpDir, { recursive: true, force: true });

    const output = JSON.parse(stdout) as {
      stats?: { passRate: number };
      results?: { stats?: { passRate: number } };
    };

    return output.stats?.passRate || output.results?.stats?.passRate || 0;
  } catch {
    // If eval fails, return 0 so this candidate doesn't win
    return 0;
  }
}

async function getBaselineScore(namespace: string): Promise<number> {
  const rows = await query<{ pass_rate: number }>(
    `SELECT pass_rate FROM pipeline.eval_runs
     WHERE team = $1
     ORDER BY run_at DESC
     LIMIT 1`,
    [namespace],
  );
  return rows[0]?.pass_rate || 0;
}

async function openResearchPR(
  cluster: Cluster,
  best: Candidate,
  allCandidates: Candidate[],
): Promise<void> {
  const topicSlug = cluster.key
    .replace(/[^a-z0-9]+/gi, "-")
    .substring(0, 40)
    .toLowerCase();
  const branch = `autoresearch/${cluster.namespace}/${topicSlug}`;
  const baseScore = await getBaselineScore(cluster.namespace);

  // Find target repo for this namespace
  const repos = await query<{ full_name: string }>(
    `SELECT full_name FROM lore.repos WHERE team = $1 LIMIT 1`,
    [cluster.namespace],
  );

  if (repos.length === 0) {
    console.error(`[job] autoresearch: no repo found for namespace ${cluster.namespace}`);
    return;
  }

  const targetRepo = repos[0].full_name;
  const filePath = `context/${cluster.namespace}/${topicSlug}.md`;

  const alternatives = allCandidates
    .filter((c) => c.approach !== best.approach)
    .map(
      (c) =>
        `- **${c.approach}**: ${(c.evalScore * 100).toFixed(1)}% (delta: ${(c.delta * 100).toFixed(1)}%)`,
    )
    .join("\n");

  const triggeringQueries = cluster.queries
    .slice(0, 10)
    .map((q) => `- ${q}`)
    .join("\n");

  try {
    await platform().createBranch(targetRepo, branch);
    await platform().commitFile(
      targetRepo,
      branch,
      filePath,
      best.content,
      `autoresearch: add context for ${topicSlug}`,
    );

    await platform().createPR(
      targetRepo,
      branch,
      `[autoresearch] ${cluster.namespace}: ${topicSlug}`,
      `## Context Experiment

**Approach:** ${best.approach}
**Eval score:** ${(baseScore * 100).toFixed(1)}% → ${(best.evalScore * 100).toFixed(1)}% (+${(best.delta * 100).toFixed(1)}%)

### Content Added
\`\`\`
${best.content.substring(0, 2000)}
\`\`\`

### Triggering Queries (${cluster.queries.length} total)
${triggeringQueries}

### Alternative Approaches
${alternatives}

---
Generated by autoresearch loop. Team reviews and merges.`,
      undefined,
      ["context-experiment-passed"],
    );

    console.log(`[job] autoresearch: opened PR on ${targetRepo} for ${cluster.key}`);
  } catch (err) {
    console.error(`[job] autoresearch: failed to open PR for ${cluster.key}:`, err);
  }
}
