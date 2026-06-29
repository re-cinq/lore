/**
 * Side-effecting route helpers: GitHub issue micro-calls, the graph-extraction
 * LLM caller, the fire-and-forget agent-service forwarders (review-reactor /
 * auto-merge, used by the GitHub webhook route), and the post-ingest producers
 * that drop events on the Floor event bus (pipeline.events).
 */

import type { Pool } from "pg";
import { Llm, insertEvent } from "@re-cinq/lore-shared";
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

/**
 * Build a graph LLM call function for extractAndUpdateGraph, routed through the
 * shared `Llm` singleton (cost logging happens inside the provider via
 * `Llm.configure`). Returns undefined when no Anthropic key is set — preserving
 * the "skip graph extraction without credentials" gate.
 */
export function makeGraphLlmCall(_pool: Pool | null): ((prompt: string) => Promise<string>) | undefined {
  if (!process.env.ANTHROPIC_API_KEY) return undefined;
  return (prompt: string) =>
    Llm.instance.complete({ prompt, jobName: "graph-extraction" }).then((r) => r.text);
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

// ── Post-ingest producers (Floor event bus) ─────────────────────────

/**
 * Project specs/adrs/test-report/coverage into the spec-trace graph: emit an
 * `internal.ingest.spec_trace` event. The Floor loop's handler runs
 * dispatchSpecTrace, which routes by `kind` (repo-read for specs/adrs, payload for
 * test-report/coverage). No dedupe key — projection is content-hash idempotent, so
 * a `force` re-ingest must not be collapsed away. No-op when there's no DB pool.
 */
export async function triggerAgentSpecTrace(pool: Pool | null, repo: string, kind: string, payload: unknown): Promise<void> {
  if (!pool) return;
  await insertEvent(pool, {
    eventName: "internal.ingest.spec_trace",
    source: "internal",
    params: { repo, kind, payload },
  }).catch((err) => console.warn("[spec-trace] event insert failed:", (err as Error).message));
}

/**
 * Validate a repo's inline spec→test links after an ingest: emit an
 * `internal.ingest.spec_coverage_validate` event. The Floor loop's handler runs
 * validateSpecCoverageJob. No-op when there's no DB pool.
 */
export async function triggerAgentSpecCoverageValidate(pool: Pool | null, repo: string): Promise<void> {
  if (!pool) return;
  await insertEvent(pool, {
    eventName: "internal.ingest.spec_coverage_validate",
    source: "internal",
    params: { repo },
  }).catch((err) => console.warn("[spec-coverage-validate] event insert failed:", (err as Error).message));
}
