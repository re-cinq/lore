# Feature Specification: get_pr_status Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | get_pr_status          |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `get_pr_status`        |
| Module   | mcp-server (platform)  |
| Scope    | shared                 |

## Problem Statement

A task's PR is the canonical artifact, but its true state lives on GitHub:
draft, open, checks-failing, changes-requested, approved, merged, or
closed. The caller needs a single derived status — folding PR state,
check-run conclusions, and review verdicts into one word — plus the
underlying checks and reviews, without scripting the GitHub REST API.

## Solution

A `get_pr_status` MCP tool that calls `fetchPrStatus`, which fetches the
PR, its reviews, and the head commit's check-runs over the GitHub REST
API, then computes a single `computed_status` from a fixed precedence
(merged → closed → draft → checks-failing → changes-requested → approved →
open) and returns it with the normalized checks and reviews. Returns a
configuration message when GitHub credentials are absent.

- IMPLEMENTED_BY: registration + handler — [`pipeline-tools.ts#L112`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L112)
- IMPLEMENTED_BY: GitHub fetch + status derivation — [`github-client.ts#L109`](../../../mcp-server/src/platform/github-client.ts#L109)

## Acceptance Criteria

1. A merged/closed/draft/checks-failing/changes-requested/approved/open PR maps to the matching `computed_status` by fixed precedence. (untested: `fetchPrStatus` issues three live `fetch` calls to api.github.com with no injectable seam; the status derivation is not extracted as a pure function)
2. Missing GitHub credentials return a configuration message instead of throwing. (untested: the null path is gated on `getGitHubToken()` reading process env / GitHub App state — no deterministic seam without live config)

## Out of Scope

- Persisting PR state to the task row (the watcher / merge-check jobs own that).
- Posting reviews or comments (separate platform calls).
