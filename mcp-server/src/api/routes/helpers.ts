/**
 * Side-effecting helpers shared by multiple handlers: GitHub issue
 * micro-calls, the graph-extraction LLM caller, and the fire-and-forget
 * forwarders that wake the agent service.
 */

import type { Pool } from "pg";
import { getGitHubToken } from "../../platform/github-client.js";

// ── GitHub helpers (used by webhook + spec-merge routes) ─────────────

export async function ghIssueComment(repo: string, issueNumber: number, body: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json" },
    body: JSON.stringify({ body }),
  });
}

export async function ghAddLabel(repo: string, issueNumber: number, label: string): Promise<void> {
  const token = await getGitHubToken();
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "application/vnd.github+json" },
    body: JSON.stringify({ labels: [label] }),
  });
}

export async function readFileFromGitHub(repo: string, path: string, ref: string): Promise<string | null> {
  const token = await getGitHubToken();
  if (!token) return null;
  const [owner, repoName] = repo.split("/");
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURIComponent(path)}?ref=${ref}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
      },
    },
  );
  if (!response.ok) return null;
  return response.text();
}

/** Build a graph LLM call function for extractAndUpdateGraph. */
export function makeGraphLlmCall(pool: Pool | null): ((prompt: string) => Promise<string>) | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;
  const model = process.env.LORE_GRAPH_MODEL || "claude-haiku-4-5-20251001";
  return async (prompt: string) => {
    const start = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
    });
    const result = await res.json() as any;
    const durationMs = Date.now() - start;
    if (result.usage && pool) {
      const costUsd = result.usage.input_tokens * 0.8 / 1_000_000 + result.usage.output_tokens * 4.0 / 1_000_000;
      pool.query(
        `INSERT INTO pipeline.llm_calls (task_id, job_name, model, input_tokens, output_tokens, cost_usd, duration_ms) VALUES (NULL, 'graph-extraction', $1, $2, $3, $4, $5)`,
        [model, result.usage.input_tokens, result.usage.output_tokens, costUsd, durationMs],
      ).catch(() => {});
    }
    return result.content[0].text;
  };
}

// ── Agent service forwarders (fire-and-forget) ──────────────────────

/**
 * Forward a review-reactor trigger to the agent service. Fire-and-forget:
 * the agent returns 202 before running the LLM, so this won't block the
 * webhook response. Safe to await briefly for the 202 itself.
 */
export async function triggerAgentReviewReactor(repo: string, prNumber: number): Promise<void> {
  const agentUrl = process.env.LORE_AGENT_URL;
  const token = process.env.LORE_AGENT_INTERNAL_TOKEN;
  if (!agentUrl || !token) {
    console.warn("[webhook] LORE_AGENT_URL or LORE_AGENT_INTERNAL_TOKEN not set — skipping review-reactor trigger");
    return;
  }
  try {
    await fetch(`${agentUrl.replace(/\/+$/, "")}/api/trigger/review-reactor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ repo, pr_number: prNumber }),
    });
  } catch (err: any) {
    console.warn("[webhook] review-reactor trigger failed:", err.message);
  }
}

/**
 * Forward a spec-coverage-validate trigger to the agent. Fire-and-
 * forget: the agent returns 202 before parsing + resolving, so this
 * won't block the /api/ingest response. Replaces the v2
 * triggerAgentSpecTestLinker.
 */
export async function triggerAgentSpecCoverageValidate(repo: string): Promise<void> {
  const agentUrl = process.env.LORE_AGENT_URL;
  const token = process.env.LORE_AGENT_INTERNAL_TOKEN;
  if (!agentUrl || !token) {
    console.warn("[ingest] LORE_AGENT_URL or LORE_AGENT_INTERNAL_TOKEN not set — skipping spec-coverage-validate trigger");
    return;
  }
  try {
    await fetch(`${agentUrl.replace(/\/+$/, "")}/api/trigger/spec-coverage-validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ repo }),
    });
  } catch (err: any) {
    console.warn("[ingest] spec-coverage-validate trigger failed:", err.message);
  }
}

/**
 * Forward a spec-trace projection trigger to the agent. Fire-and-forget:
 * the agent returns 202 before projecting into Dgraph, so this never blocks
 * the test-report / coverage route response. `kind` selects the ingest path
 * ("test-report" | "coverage"); `payload` is the route's already-parsed body.
 */
export async function triggerAgentSpecTrace(repo: string, kind: string, payload: unknown): Promise<void> {
  const agentUrl = process.env.LORE_AGENT_URL;
  const token = process.env.LORE_AGENT_INTERNAL_TOKEN;
  if (!agentUrl || !token) {
    console.warn("[spec-trace] LORE_AGENT_URL or LORE_AGENT_INTERNAL_TOKEN not set — skipping spec-trace trigger");
    return;
  }
  try {
    await fetch(`${agentUrl.replace(/\/+$/, "")}/api/trigger/spec-trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ repo, kind, payload }),
    });
  } catch (err: any) {
    console.warn("[spec-trace] spec-trace trigger failed:", err.message);
  }
}

/**
 * Forward an auto-merge re-trigger to the agent. Same shape as the
 * review-reactor forwarder. Used by `check_run.completed` /
 * `check_suite.completed` webhook handlers so dark-mode PRs re-evaluate
 * auto-merge once CI completes — the initial fire at PR-creation time
 * always sees an empty `check_runs` array.
 */
export async function triggerAgentAutoMerge(repo: string, prNumber: number): Promise<void> {
  const agentUrl = process.env.LORE_AGENT_URL;
  const token = process.env.LORE_AGENT_INTERNAL_TOKEN;
  if (!agentUrl || !token) {
    console.warn("[webhook] LORE_AGENT_URL or LORE_AGENT_INTERNAL_TOKEN not set — skipping auto-merge trigger");
    return;
  }
  try {
    await fetch(`${agentUrl.replace(/\/+$/, "")}/api/trigger/auto-merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ repo, pr_number: prNumber }),
    });
  } catch (err: any) {
    console.warn("[webhook] auto-merge trigger failed:", err.message);
  }
}
