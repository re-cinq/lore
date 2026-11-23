import { createHash, generateKeyPairSync } from "node:crypto";
import type { RequestRoute } from "@hapi/hapi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_TOKEN,
  makePool,
  useRateLimitSafeClock,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { buildServer } from "../../app/build-server.js";
import { repoDeclarationOf, type RepoLevel } from "./repo-guard.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const DANA_TOKEN = "dana-session";

const APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

const SPEC_ADMIN_ROUTES: readonly string[] = [
  "POST /api/onboard",
  "PUT /api/repos/{owner}/{repo}/settings",
  "POST /api/repos/{owner}/{repo}/webhook/ensure",
  "POST /api/repos/{owner}/{repo}/utopia/setup",
  "POST /api/repos/{owner}/{repo}/utopia/backfill",
  "POST /api/repos/{owner}/{repo}/utopia/reset",
  "POST /api/repos/{owner}/{repo}/utopia/commits",
  "POST /api/repos/{owner}/{repo}/utopia/memory",
  "POST /api/repos/{owner}/{repo}/utopia/releases",
  "POST /api/repos/{owner}/{repo}/utopia/tracker",
  "PUT /api/repos/{owner}/{repo}/loops/{key}",
  "DELETE /api/repos/{owner}/{repo}/loops/{key}/pause",
  "POST /api/repos/{owner}/{repo}/agent-definitions",
  "PUT /api/repos/{owner}/{repo}/agent-definitions/{name}",
  "DELETE /api/repos/{owner}/{repo}/agent-definitions/{name}",
  "POST /api/repos/{owner}/{repo}/mirror/move",
];

const ORG_WIDE_ROUTES = new Set<string>([
  "GET /healthz",
  "GET /dist/lore-code-trace/{artifact*}",
  "GET /api/openapi.json",
  "GET /api/docs",
  "GET /api/auth/login",
  "GET /api/auth/callback",
  "POST /api/auth/redeem",
  "GET /api/auth/me",
  "GET /api/auth/access",
  "POST /api/auth/logout",
  "POST /api/tokens",
  "GET /api/tokens",
  "DELETE /api/tokens",
  "* /api/tokens",
  "GET /api/platform/llm-status",
  "GET /api/versions",
  "GET /api/service-versions",
  "POST /api/service-versions",
  "PUT /api/inbox/items/{item_id}/state",
  "POST /api/webhook/github",
  "POST /api/webhook/slack",
  "POST /api/webhook/slack-events",
  "POST /api/webhook/incident",
  "POST /api/github/installations",
  "GET /api/github/installations",
  "GET /api/agent-definitions",
  "PUT /api/agent-definitions/{name}",
  "DELETE /api/agent-definitions/{name}",
  "GET /api/agent-definitions/usage",
  "GET /api/agent-definitions/activity",
  "GET /api/agent-definitions/presence",
  "GET /api/skill-definitions",
  "POST /api/skill-definitions",
  "PUT /api/skill-definitions/{name}",
  "DELETE /api/skill-definitions/{name}",
  "GET /api/settings",
  "PUT /api/settings",
  "GET /api/pack",
  "POST /api/pack/sync",
  "GET /api/pools",
  "GET /api/pools/{name}",
  "GET /api/usage",
  "GET /api/agent-stats",
  "GET /api/memory-audit",
  "POST /api/embeddings",
  "POST /api/spec-links/parse",
  "POST /api/floor/git-credential",
  "POST /api/utopia/memory",
  "GET /api/job-runs/{id}",
  "GET /api/job-run-logs",
  "POST /api/ingest/reembed",
  "POST /api/episode",
]);

const MULTI_REPO_ROUTES = new Set<string>([
  "GET /api/repos",
  "GET /api/repos/available",
  "GET /api/inbox",
  "GET /api/tasks",
  "GET /api/task-stats",
  "GET /api/analytics",
  "GET /api/analytics-overview",
  "GET /api/analytics/spend-window",
  "GET /api/trace/adrs",
  "GET /api/trace/specs",
  "GET /api/episodes",
  "GET /api/graph-browse",
  "GET /api/memories",
  "GET /api/floor-runs",
  "POST /api/floor-runs/stream-token",
]);

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RouteProbeSpec {
  defaultLevel: RepoLevel;
  buildRequest: (repo: string) => { url: string; payload?: object };
}

const RUN_FOR_REPO: Record<string, string> = {
  "acme/app": "run-acme",
  "other/secret": "run-secret",
};

const TASK_FOR_REPO: Record<string, string> = {
  "acme/app": "t-acme",
  "other/secret": "t-secret",
};

const PLAN_FOR_REPO: Record<string, string> = {
  "acme/app": "0f3c2a2e-6b1a-4c5e-9d2f-1a2b3c4d5e6f",
  "other/secret": "11111111-2222-4333-8444-555555555555",
};

const ROUTE_PROBES: Record<string, RouteProbeSpec> = {
  "POST /api/onboard": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: "/api/onboard",
      payload: { repo, branch: "main" },
    }),
  },
  "GET /api/repos/{owner}/{repo}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}` }),
  },
  "GET /api/repos/{owner}/{repo}/status": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/status` }),
  },
  "GET /api/repo-status": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repo-status?repo=${repo}` }),
  },
  "PUT /api/repos/{owner}/{repo}/settings": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/settings`,
      payload: {
        settings: { auto_merge: { enabled: true, min_age_hours: 0 } },
      },
    }),
  },
  "GET /api/repos/{owner}/{repo}/sessions": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/sessions` }),
  },
  "GET /api/repos/{owner}/{repo}/activity-counts": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/activity-counts` }),
  },
  "GET /api/repos/{owner}/{repo}/onboarded": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/onboarded` }),
  },
  "GET /api/repos/{owner}/{repo}/issues": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/issues` }),
  },
  "GET /api/repos/{owner}/{repo}/labels": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/labels` }),
  },
  "GET /api/repos/{owner}/{repo}/ci-conclusion": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/ci-conclusion?branch=main`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/ci-failures": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/ci-failures?branch=main`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/ci-jobs/{job_id}/log": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/ci-jobs/101/log` }),
  },
  "GET /api/repos/{owner}/{repo}/github/details": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/github/details` }),
  },
  "GET /api/repos/{owner}/{repo}/github/file": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/github/file?path=README.md`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/github/pulls/{number}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/github/pulls/42` }),
  },
  "GET /api/repos/{owner}/{repo}/github/readme": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/github/readme` }),
  },
  "GET /api/repos/{owner}/{repo}/issues/{number}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/issues/1` }),
  },
  "GET /api/repos/{owner}/{repo}/pulls/{number}/files": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/pulls/1/files` }),
  },
  "GET /api/repos/{owner}/{repo}/auto-merge": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/auto-merge` }),
  },
  "GET /api/repos/{owner}/{repo}/auto-merge/kpis": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/auto-merge/kpis` }),
  },
  "GET /api/repos/{owner}/{repo}/pulls/{number}/blocked-reason": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/pulls/1/blocked-reason`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/blocked-pulls": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/blocked-pulls` }),
  },
  "GET /api/repos/{owner}/{repo}/changelog": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/changelog` }),
  },
  "POST /api/repos/{owner}/{repo}/changelog/{week}/intro": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/changelog/2026-W47/intro`,
    }),
  },
  "POST /api/repos/{owner}/{repo}/release": {
    defaultLevel: "write",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/release` }),
  },
  "GET /api/repos/{owner}/{repo}/daily-digest": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/daily-digest` }),
  },
  "GET /api/repos/{owner}/{repo}/backlog": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/backlog` }),
  },
  "GET /api/repos/{owner}/{repo}/triage": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/triage` }),
  },
  "GET /api/repos/{owner}/{repo}/tickets/search": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/tickets/search?query=auth`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/pr-status": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/pr-status?pr=1` }),
  },
  "GET /api/pr-status": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/pr-status?repo=${repo}&pr_number=1`,
    }),
  },

  "GET /api/repos/{owner}/{repo}/webhook": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/webhook` }),
  },
  "POST /api/repos/{owner}/{repo}/webhook/ensure": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/webhook/ensure` }),
  },
  "GET /api/repos/{owner}/{repo}/webhook/secret": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/webhook/secret` }),
  },
  "POST /api/repos/{owner}/{repo}/branches": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/branches`,
      payload: { branch: "feat/x" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/commit": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/commit`,
      payload: {
        branch: "feat/x",
        path: "a.txt",
        content: "hi",
        message: "msg",
      },
    }),
  },
  "POST /api/repos/{owner}/{repo}/pulls": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/pulls`,
      payload: { branch: "feat/x", title: "PR", body: "desc" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/issues": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/issues`,
      payload: { title: "Bug", body: "Broken" },
    }),
  },
  "PATCH /api/repos/{owner}/{repo}/issues/{number}": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/issues/1`,
      payload: { title: "Updated" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/issues/{number}/sub-issues": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/issues/1/sub-issues`,
      payload: { child: 2 },
    }),
  },
  "POST /api/repos/{owner}/{repo}/tasks": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/tasks`,
      payload: { description: "Work", taskType: "chore" },
    }),
  },
  "GET /api/repos/{owner}/{repo}/tasks/drift": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/tasks/drift` }),
  },
  "GET /api/repos/{owner}/{repo}/tasks/open-like": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/tasks/open-like?task_type=chore`,
    }),
  },
  "POST /api/repos/{owner}/{repo}/mirror/move": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/mirror/move`,
      payload: { dry_run: true },
    }),
  },

  "GET /api/repos/{owner}/{repo}/agent-definitions/{name?}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/agent-definitions` }),
  },
  "POST /api/repos/{owner}/{repo}/agent-definitions": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/agent-definitions`,
      payload: { name: "custom", prompt: "hi" },
    }),
  },
  "PUT /api/repos/{owner}/{repo}/agent-definitions/{name}": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/agent-definitions/coder`,
      payload: { prompt: "hi" },
    }),
  },
  "DELETE /api/repos/{owner}/{repo}/agent-definitions/{name}": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/agent-definitions/coder`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/loops": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/loops` }),
  },
  "PUT /api/repos/{owner}/{repo}/loops/{key}": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/loops/implementation`,
      payload: { enabled: true },
    }),
  },
  "DELETE /api/repos/{owner}/{repo}/loops/{key}/pause": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/loops/implementation/pause`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/implementation-loop": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/implementation-loop`,
    }),
  },
  "POST /api/repos/{owner}/{repo}/loops/implementation/tickets/{issue}/start": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/loops/implementation/tickets/1/start`,
    }),
  },
  "GET /api/repos/{owner}/{repo}/code-review": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/code-review` }),
  },
  "GET /api/repos/{owner}/{repo}/spec-upkeep": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/spec-upkeep` }),
  },
  "GET /api/repos/{owner}/{repo}/spec-tickets": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/spec-tickets` }),
  },

  "POST /api/repos/{owner}/{repo}/utopia/setup": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/utopia/setup`,
      payload: { session_token: "utopia-jwt", workspace_id: "ws-1" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/utopia/backfill": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/utopia/backfill` }),
  },
  "POST /api/repos/{owner}/{repo}/utopia/commits": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/utopia/commits`,
      payload: {},
    }),
  },
  "POST /api/repos/{owner}/{repo}/utopia/tracker": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/utopia/tracker` }),
  },
  "POST /api/repos/{owner}/{repo}/utopia/releases": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/utopia/releases` }),
  },
  "POST /api/repos/{owner}/{repo}/utopia/reset": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/utopia/reset` }),
  },
  "POST /api/repos/{owner}/{repo}/utopia/memory": {
    defaultLevel: "admin",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/utopia/memory` }),
  },

  "GET /api/repos/{owner}/{repo}/chunk-summary": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/chunk-summary` }),
  },
  "GET /api/repos/{owner}/{repo}/chunks/{kind}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/chunks/specs` }),
  },
  "POST /api/repos/{owner}/{repo}/chunks/prune": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/chunks/prune`,
      payload: { present_paths: ["README.md"] },
    }),
  },
  "POST /api/repos/{owner}/{repo}/ingest": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/ingest`,
      payload: {
        kind: "specs",
        commit: "abcdef1",
        base_commit: null,
        files: [],
      },
    }),
  },
  "GET /api/repos/{owner}/{repo}/ingest-state": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/ingest-state?kind=chunks`,
    }),
  },
  "POST /api/repos/{owner}/{repo}/ingest-graph": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/ingest-graph`,
      payload: { kinds: ["specs"] },
    }),
  },
  "GET /api/repos/{owner}/{repo}/events/{id}/payload": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/events/evt-1/payload`,
    }),
  },
  "POST /api/repos/{owner}/{repo}/impact": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/impact`,
      payload: {},
    }),
  },
  "GET /api/repos/{owner}/{repo}/impact/base": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/impact/base` }),
  },
  "GET /api/repos/{owner}/{repo}/trace/{kind}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/trace/specs` }),
  },
  "POST /api/repos/{owner}/{repo}/trace/overlay-drop": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/trace/overlay-drop`,
      payload: { branch: "feat" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/explain": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/explain`,
      payload: {
        path: "src/a.ts",
        start_line: 1,
        end_line: 2,
        code: "const x = 1;",
      },
    }),
  },
  "POST /api/ingest": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/ingest",
      payload: { repo, files: [] },
    }),
  },
  "GET /api/context": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/context?repo=${repo}&query=auth` }),
  },
  "POST /api/context": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: "/api/context",
      payload: { repo, query: "auth" },
    }),
  },
  "GET /api/search-context": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/search-context?repo=${repo}&query=auth`,
    }),
  },
  "POST /api/search-context": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: "/api/search-context",
      payload: { repo, query: "auth" },
    }),
  },
  "GET /api/chunks": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/chunks?repo=${repo}` }),
  },
  "GET /api/chunks/by-path": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/chunks/by-path?repo=${repo}&path=README.md`,
    }),
  },
  "GET /api/chunk-types": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/chunk-types?repo=${repo}` }),
  },
  "GET /api/graph": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/graph?repo=${repo}` }),
  },
  "GET /api/memory-search": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/memory-search?repo=${repo}&q=auth` }),
  },
  "POST /api/context-assembly/report": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/context-assembly/report",
      payload: {
        repo,
        query: "auth",
        sources: [],
        tokens_used: 10,
      },
    }),
  },
  "GET /api/context-evals": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/context-evals?repo=${repo}` }),
  },
  "POST /api/context-evals": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/context-evals",
      payload: { repo, path: "README.md" },
    }),
  },
  "POST /api/context-evals/ticket": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/context-evals/ticket",
      payload: {
        repo,
        ticket: { number: 1, title: "Fix auth", body: "desc" },
      },
    }),
  },
  "GET /api/context-evals/documents": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/context-evals/documents?repo=${repo}`,
    }),
  },

  "POST /api/memory": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/memory",
      payload: { action: "write", key: "k1", value: "v1", repo },
    }),
  },
  "POST /api/session-summary": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/session-summary",
      payload: { repo, session_log: "did work" },
    }),
  },
  "GET /api/events": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/events?repo=${repo}` }),
  },
  "GET /api/repo-tasks": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repo-tasks?repo=${repo}` }),
  },
  "GET /api/agent-activity": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/agent-activity?repo=${repo}` }),
  },
  "GET /api/audit-log": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/audit-log?repo=${repo}&event_types=agent_created`,
    }),
  },

  "GET /api/task/{id}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/task/${TASK_FOR_REPO[repo]}` }),
  },
  "POST /api/task": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/task",
      payload: { task_id: TASK_FOR_REPO[repo], action: "cancel" },
    }),
  },
  "GET /api/tasks/{id}/runtime": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/tasks/${TASK_FOR_REPO[repo]}/runtime`,
    }),
  },
  "GET /api/tasks/{id}/timeline": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/tasks/${TASK_FOR_REPO[repo]}/timeline`,
    }),
  },
  "GET /api/task-groups/{id}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/task-groups/${TASK_FOR_REPO[repo]}`,
    }),
  },
  "GET /api/tasks/by-pr/{owner}/{repo}/{number}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/tasks/by-pr/${repo}/1` }),
  },
  "GET /api/task-logs": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/task-logs?task_id=${TASK_FOR_REPO[repo]}&repo=${repo}`,
    }),
  },
  "POST /api/task-logs": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/task-logs",
      payload: { task_id: TASK_FOR_REPO[repo], repo, logs: "line" },
    }),
  },
  "POST /api/review/start": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/review/start",
      payload: { repo, pr_number: 1 },
    }),
  },
  "GET /api/assembly-runs": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/assembly-runs?repo=${repo}` }),
  },
  "GET /api/assembly-lines": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/assembly-lines?repo=${repo}` }),
  },
  "GET /api/assembly-runs/{id}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}`,
    }),
  },
  "GET /api/assembly-lines/{id}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-lines/${RUN_FOR_REPO[repo]}`,
    }),
  },
  "GET /api/assembly-runs/{id}/nodes": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/nodes`,
    }),
  },
  "GET /api/assembly-lines/{id}/nodes": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-lines/${RUN_FOR_REPO[repo]}/nodes`,
    }),
  },
  "GET /api/assembly-runs/{id}/token-usage": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/token-usage`,
    }),
  },
  "GET /api/assembly-lines/{id}/token-usage": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-lines/${RUN_FOR_REPO[repo]}/token-usage`,
    }),
  },
  "GET /api/assembly-runs/{id}/dod": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/dod`,
    }),
  },
  "GET /api/assembly-runs/{id}/pull-files": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/pull-files`,
    }),
  },
  "POST /api/assembly-runs/{id}/stream-token": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/stream-token`,
      payload: { user: { id: "u1", name: "Ben" } },
    }),
  },
  "POST /api/assembly-runs/{id}/cancel": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/cancel`,
      payload: {},
    }),
  },
  "POST /api/assembly-runs/{id}/nodes/{node}/run": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/nodes/coder/run`,
      payload: {},
    }),
  },
  "GET /api/assembly-runs/{id}/upgrade": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/upgrade`,
    }),
  },
  "POST /api/assembly-runs/{id}/upgrade": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/upgrade`,
    }),
  },
  "GET /api/assembly-runs/{id}/turns": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/turns`,
    }),
  },
  "GET /api/assembly-runs/{id}/events": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/events`,
    }),
  },
  "GET /api/assembly-runs/{id}/nodes/{name}/logs": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/nodes/coder/logs`,
    }),
  },
  "GET /api/assembly-runs/{id}/blobs/{hash}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/blobs/sha256-${"a".repeat(64)}`,
    }),
  },
  "GET /api/assembly-runs/{id}/blob-previews": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/blob-previews`,
    }),
  },
  "GET /api/assembly-runs/{id}/bag": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/bag`,
    }),
  },
  "GET /api/assembly-runs/{id}/visits/{visitId}/model-calls": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/visits/v1/model-calls`,
    }),
  },
  "GET /api/assembly-runs/{id}/visits/{visitId}/events": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/assembly-runs/${RUN_FOR_REPO[repo]}/visits/v1/events`,
    }),
  },
  "POST /api/floor-runs/stream-token": {
    defaultLevel: "read",
    buildRequest: (_repo) => ({
      url: "/api/floor-runs/stream-token",
      payload: { user: { id: "u1", name: "Ben" } },
    }),
  },
  "GET /api/floor-runs": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/floor-runs?repo=${repo}` }),
  },
  "PUT /api/inbox/items/{item_id}/state": {
    defaultLevel: "read",
    buildRequest: (_repo) => ({
      url: "/api/inbox/items/item-1/state",
      payload: { handled: true },
    }),
  },

  "GET /api/repos/{owner}/{repo}/plans": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/repos/${repo}/plans` }),
  },
  "DELETE /api/repos/{owner}/{repo}/plans/{id}": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}`,
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/collab-token": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/collab-token`,
      payload: { user: { id: "u1", name: "Ben" }, role: "read" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/run-stream-token": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/run-stream-token`,
      payload: { user: { id: "u1", name: "Ben" } },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/drafting": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/drafting`,
      payload: { known: "context", createdBy: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/refine": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/refine`,
      payload: {
        actor: "ben",
        slot: "scope",
        title: "Scope",
        baseHash: "abc",
        inputs: {},
        uses: {},
      },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/approve": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/approve`,
      payload: { approvedBy: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/reopen": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/reopen`,
      payload: { reopenedBy: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/spec-work": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/spec-work`,
      payload: { createdBy: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/spec-rework": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/spec-rework`,
      payload: { actor: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/validate": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/validate`,
      payload: { actor: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/prototype": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/prototype`,
      payload: { actor: "ben" },
    }),
  },
  "POST /api/repos/{owner}/{repo}/plans/{id}/author-waiting": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/repos/${repo}/plans/${PLAN_FOR_REPO[repo]}/author-waiting`,
      payload: { actor: "ben" },
    }),
  },
  "POST /api/plans": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: "/api/plans",
      payload: { repo, title: "Plan", type: "feature", createdBy: "ben" },
    }),
  },
  "GET /api/plans/{planId}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({ url: `/api/plans/${PLAN_FOR_REPO[repo]}` }),
  },
  "GET /api/plans/{planId}/versions": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/versions`,
    }),
  },
  "GET /api/plans/{planId}/versions/{number}": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/versions/1`,
    }),
  },
  "POST /api/plans/{planId}/approve": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/approve`,
      payload: { approvedBy: "ben" },
    }),
  },
  "POST /api/plans/{planId}/reopen": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/reopen`,
      payload: {},
    }),
  },
  "POST /api/plans/{planId}/agent-edits": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/agent-edits`,
      payload: { actor: "ben", ops: [] },
    }),
  },
  "POST /api/plans/{planId}/refine-done": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/refine-done`,
      payload: { slot: "scope", uses: { questions: [], comments: [] } },
    }),
  },
  "POST /api/plans/{planId}/agent-presence": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/agent-presence`,
      payload: { user: { name: "ben", color: "#000" } },
    }),
  },
  "DELETE /api/plans/{planId}/agent-presence": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/agent-presence`,
    }),
  },
  "POST /api/plans/{planId}/agent-editing": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/agent-editing`,
      payload: { slot: "scope" },
    }),
  },
  "POST /api/plans/{planId}/proposals": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/proposals`,
      payload: { actor: "ben", slot: "scope", baseHash: "abc", ops: [] },
    }),
  },
  "GET /api/plans/{id}/markdown": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/markdown`,
    }),
  },
  "GET /api/plans/{id}/agent-view": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/agent-view`,
    }),
  },
  "POST /api/plans/{id}/agent-file": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/agent-file`,
      payload: { actor: "ben", markdown: "# Plan", refine: null },
    }),
  },
  "POST /api/plans/{id}/refine-failed": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/refine-failed`,
      payload: { slot: "scope", reason: "failed" },
    }),
  },
  "POST /api/plans/{id}/refine-settled": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/refine-settled`,
      payload: { outcome: "success" },
    }),
  },
  "GET /api/plans/{id}/story": {
    defaultLevel: "read",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/story`,
    }),
  },
  "POST /api/plans/{id}/story": {
    defaultLevel: "write",
    buildRequest: (repo) => ({
      url: `/api/plans/${PLAN_FOR_REPO[repo]}/story`,
      payload: { issueNumber: 1, setBy: "ben" },
    }),
  },
};

describe("route level declarations, admin route list, and GitHub permission enforcement (SC-001, SC-014, SC-002)", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.GITHUB_APP_ID = "999";
    process.env.GITHUB_APP_PRIVATE_KEY = APP_PRIVATE_KEY;
    process.env.GITHUB_APP_INSTALLATION_ID = "12345";
    delete process.env.GITHUB_TOKEN;
    delete process.env.UTOPIA_API_URL;
    delete process.env.LORE_WEBHOOK_URL;
    delete process.env.LORE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("declares a repository level and source (or SPANS_REPOS) on every registered route that concerns a repository", () => {
    const { server } = createLoreServer({});
    const routes = server.table();
    const withoutDeclaration = routes
      .filter(
        (route) =>
          !ORG_WIDE_ROUTES.has(routeKey(route)) &&
          !repoDeclarationOf({ route }),
      )
      .map(routeKey)
      .sort();
    const misclassifiedOrgWide = routes
      .filter((route) => isMisclassifiedOrgWide(route))
      .map(routeKey)
      .sort();

    expect({ withoutDeclaration, misclassifiedOrgWide }).toEqual({
      withoutDeclaration: [],
      misclassifiedOrgWide: [],
    });
  });

  it("declares admin on the exact set of routes listed in the spec's Levels section and no others", () => {
    const { server } = createLoreServer({});
    const actualAdmin = server
      .table()
      .filter((route) => repoDeclarationOf({ route })?.level === "admin")
      .map(routeKey);
    const actualSet = new Set(actualAdmin);
    const expectedSet = new Set(SPEC_ADMIN_ROUTES);
    const extraAdmin = actualAdmin
      .filter((key) => !expectedSet.has(key))
      .sort();
    const absentAdmin = [...expectedSet]
      .filter((key) => !actualSet.has(key))
      .sort();

    expect({ extraAdmin, absentAdmin }).toEqual({
      extraAdmin: [],
      absentAdmin: [],
    });
  });

  it(
    "refuses with 403 on every single-repository route when the caller's GitHub permission is one level below what the route needs",
    { timeout: 30_000 },
    async () => {
      const { server, call } = createLoreServer({
        "other/secret:ben": { status: 404 },
        "acme/app:ben": { status: 200, permission: "read" },
        "acme/app:dana": { status: 200, permission: "write" },
      });
      const routes = singleRepoRoutes(server.table());
      const unprobed = routes
        .map(routeKey)
        .filter((key) => !ROUTE_PROBES[key])
        .sort();
      const outcomes = await probeAllOneLevelBelow(routes, call);
      const unexpected = outcomes.filter((entry) => entry.statusCode !== 403);

      expect({ unprobed, unexpected }).toEqual({
        unprobed: [],
        unexpected: [],
      });
    },
  );

  it("refuses POST /api/onboard with 403 when the caller has write but not admin on the repository, and creates no onboarding task", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer({
      "acme/app:dana": { status: 200, permission: "write" },
    });

    const response = await call("POST", "/api/onboard", DANA_TOKEN, {
      repo: "acme/app",
      branch: "main",
    });

    expect({
      statusCode: response.statusCode,
      writes: sqlCalls.filter(isTaskOrRepoWrite),
      githubWrites: githubCalls.filter(isGithubRepoWrite),
    }).toEqual({
      statusCode: 403,
      writes: [],
      githubWrites: [],
    });
  });
});

const TICKET_START_URL =
  "/api/repos/acme/app/loops/implementation/tickets/1/start";

describe("POST /api/repos/{owner}/{repo}/loops/implementation/tickets/{issue}/start refusals at write", () => {
  useRateLimitSafeClock();

  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    process.env.GITHUB_APP_ID = "999";
    process.env.GITHUB_APP_PRIVATE_KEY = APP_PRIVATE_KEY;
    process.env.GITHUB_APP_INSTALLATION_ID = "12345";
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
  });

  it("refuses a person with only read on the repository with 403 and writes nothing, while admitting a person with write past the guard", async () => {
    const { call, sqlCalls, githubCalls } = createLoreServer({
      "acme/app:ben": { status: 200, permission: "read" },
      "acme/app:dana": { status: 200, permission: "write" },
    });

    const refused = await call("POST", TICKET_START_URL, BEN_TOKEN);
    const writesOnRefusal = sqlCalls.filter(isDataWrite);
    const githubWritesOnRefusal = githubCalls.filter(isGithubRepoWrite);
    const admitted = await call("POST", TICKET_START_URL, DANA_TOKEN);

    expect({
      refused: refused.statusCode,
      writesOnRefusal,
      githubWritesOnRefusal,
      admittedPastGuard: ![401, 403].includes(admitted.statusCode),
    }).toEqual({
      refused: 403,
      writesOnRefusal: [],
      githubWritesOnRefusal: [],
      admittedPastGuard: true,
    });
  });

  it("refuses a person who starts a ticket on a repository GitHub says they cannot see, and writes nothing", async () => {
    const { call, sqlCalls } = createLoreServer({
      "other/secret:ben": { status: 404 },
    });

    const response = await call(
      "POST",
      "/api/repos/other/secret/loops/implementation/tickets/1/start",
      BEN_TOKEN,
    );

    expect({
      statusCode: response.statusCode,
      writes: sqlCalls.filter(isDataWrite),
    }).toEqual({ statusCode: 403, writes: [] });
  });

  it("refuses a caller with no credential or a made-up one with 401 and writes nothing", async () => {
    const { server, sqlCalls } = createLoreServer({});

    const noCredential = await server.inject({
      method: "POST",
      url: TICKET_START_URL,
    });
    const madeUp = await server.inject({
      method: "POST",
      url: TICKET_START_URL,
      headers: { authorization: "Bearer made-up-token" },
    });

    expect({
      statuses: [noCredential.statusCode, madeUp.statusCode],
      writes: sqlCalls.filter(isDataWrite),
    }).toEqual({ statuses: [401, 401], writes: [] });
  });

  it.each([403, 422])(
    "refuses with 403 and writes nothing when GitHub answers the permission lookup with %i",
    async (status) => {
      const { call, sqlCalls } = createLoreServer({
        "acme/app:dana": { status },
      });

      const response = await call("POST", TICKET_START_URL, DANA_TOKEN);

      expect({
        statusCode: response.statusCode,
        writes: sqlCalls.filter(isDataWrite),
      }).toEqual({ statusCode: 403, writes: [] });
    },
  );
  it("refuses with 403 and writes nothing when GitHub answers the permission lookup with something that is not a permission", async () => {
    const { call, sqlCalls } = createLoreServer({});
    const githubStub = globalThis.fetch;

    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());

      if (url.pathname === "/repos/acme/app/collaborators/dana/permission") {
        return jsonResponse({ permission: "superuser", role_name: "owner" });
      }

      return githubStub(input, init);
    };

    const response = await call("POST", TICKET_START_URL, DANA_TOKEN);

    expect({
      statusCode: response.statusCode,
      writes: sqlCalls.filter(isDataWrite),
    }).toEqual({ statusCode: 403, writes: [] });
  });
});

function isDataWrite(sql: string): boolean {
  return (
    /\b(INSERT|UPDATE|DELETE)\b/i.test(sql) &&
    !sql.includes("pipeline.api_tokens")
  );
}

function routeKey(route: RequestRoute): string {
  return `${route.method.toUpperCase()} ${route.path}`;
}

function isMisclassifiedOrgWide(route: RequestRoute): boolean {
  if (!ORG_WIDE_ROUTES.has(routeKey(route))) {
    return false;
  }

  return (
    route.path.includes("{owner}/{repo}") ||
    repoDeclarationOf({ route }) !== undefined
  );
}

function singleRepoRoutes(routes: RequestRoute[]): RequestRoute[] {
  return routes.filter((route) => {
    const key = routeKey(route);

    return !ORG_WIDE_ROUTES.has(key) && !MULTI_REPO_ROUTES.has(key);
  });
}

async function probeAllOneLevelBelow(
  routes: RequestRoute[],
  call: ReturnType<typeof createLoreServer>["call"],
): Promise<Array<{ route: string; level: RepoLevel; statusCode: number }>> {
  const results: Array<{
    route: string;
    level: RepoLevel;
    statusCode: number;
  }> = [];

  for (const route of routes) {
    const key = routeKey(route);
    const probe = ROUTE_PROBES[key];

    if (!probe) {
      continue;
    }
    const level = repoDeclarationOf({ route })?.level ?? probe.defaultLevel;
    const { repo, token } = callerOneLevelBelow(level);
    const req = probe.buildRequest(repo);
    const response = await injectWithDeadline(call, {
      method: route.method.toUpperCase() as HttpMethod,
      url: req.url,
      token,
      payload: req.payload,
    });

    results.push({ route: key, level, statusCode: response.statusCode });
  }

  return results;
}

const PROBE_DEADLINE_MS = 500;

function injectWithDeadline(
  call: ReturnType<typeof createLoreServer>["call"],
  request: {
    method: HttpMethod;
    url: string;
    token: string;
    payload?: object;
  },
): Promise<{ statusCode: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ statusCode: 599 }),
      PROBE_DEADLINE_MS,
    );

    call(request.method, request.url, request.token, request.payload)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({ statusCode: 500 });
      });
  });
}

const BEN_TOKEN = "ben-session";

const CALLER_BY_LEVEL: Record<RepoLevel, { repo: string; token: string }> = {
  read: { repo: "other/secret", token: BEN_TOKEN },
  write: { repo: "acme/app", token: BEN_TOKEN },
  admin: { repo: "acme/app", token: DANA_TOKEN },
};

function callerOneLevelBelow(level: RepoLevel): {
  repo: string;
  token: string;
} {
  return CALLER_BY_LEVEL[level];
}

interface PermissionReply {
  status: number;
  permission?: "admin" | "write" | "read" | "none";
}

interface RecordedGithubCall {
  method: string;
  path: string;
  authorization: string;
}

function createLoreServer(permissions: Record<string, PermissionReply>) {
  const pool = makePool();
  const sqlCalls: string[] = [];
  const githubCalls: RecordedGithubCall[] = [];

  globalThis.fetch = createGithubFetchStub(permissions, githubCalls);
  pool.query.mockImplementation((rawSql: string, params?: unknown[]) => {
    const sql = String(rawSql);

    sqlCalls.push(sql);

    return Promise.resolve({
      rows: queryRowsFor(sql, params),
    });
  });
  Object.assign(pool, {
    connect: async () => ({
      query: pool.query,
      release: () => undefined,
    }),
  });

  const server = buildServer(() => pool as never);

  return {
    server,
    sqlCalls,
    githubCalls,
    call: (method: HttpMethod, url: string, token: string, payload?: object) =>
      server.inject({
        method,
        url,
        payload,
        headers: { authorization: `Bearer ${token}` },
      }),
  };
}

function createGithubFetchStub(
  permissions: Record<string, PermissionReply>,
  recorded: RecordedGithubCall[],
): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const authorization = headerValue(init?.headers, "authorization");

    recorded.push({ method, path: url.pathname, authorization });

    return githubReplyFor(url.pathname, permissions);
  };
}

function githubReplyFor(
  pathname: string,
  permissions: Record<string, PermissionReply>,
): Response {
  if (pathname === "/app/installations/12345/access_tokens") {
    return jsonResponse({
      token: "ghs_app_installation_token",
      expires_at: "2026-11-22T00:00:00Z",
    });
  }

  const match =
    /^\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/permission$/.exec(
      pathname,
    );

  return match
    ? permissionResponse(permissions, match)
    : jsonResponse({ message: "not found" }, 404);
}

function permissionResponse(
  permissions: Record<string, PermissionReply>,
  match: RegExpExecArray,
): Response {
  const key = `${match[1]}/${match[2]}:${match[3]}`;
  const reply = permissions[key];

  if (!reply || reply.status >= 400) {
    return jsonResponse({ message: "not found" }, reply?.status ?? 404);
  }

  return jsonResponse({ permission: reply.permission ?? "none" });
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  return new Headers(headers).get(name) ?? "";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isTaskOrRepoWrite(sql: string): boolean {
  const mutates = /\b(INSERT|UPDATE|DELETE)\b/i.test(sql);

  return (
    mutates && (sql.includes("pipeline.tasks") || sql.includes("lore.repos"))
  );
}

function isGithubRepoWrite(entry: RecordedGithubCall): boolean {
  return (
    entry.path.startsWith("/repos/") &&
    entry.method !== "GET" &&
    entry.method !== "HEAD"
  );
}

const QUERY_HANDLERS: Array<{
  match: (sql: string) => boolean;
  rows: (sql: string, params: unknown[] | undefined) => unknown[];
}> = [
  {
    match: (sql) => sql.includes("UPDATE pipeline.api_tokens"),
    rows: (_sql, params) => tokenRows(params),
  },
  {
    match: (sql) => sql.includes("information_schema.tables"),
    rows: () => [{ table_schema: "platform" }],
  },
  {
    match: (sql) => sql.includes("information_schema.schemata"),
    rows: () => [{ schema_name: "platform" }],
  },
  {
    match: (sql) => sql.includes("public_mirror"),
    rows: () => [],
  },
  {
    match: (sql) => sql.includes("FROM lore.repos"),
    rows: (_sql, params) => repoRows(params),
  },
  {
    match: (sql) => sql.includes("SELECT repo FROM pipeline.assembly_runs"),
    rows: (_sql, params) => [{ repo: repoFromId(params?.[0]) }],
  },
  {
    match: (sql) => sql.includes("FROM pipeline.tasks"),
    rows: (_sql, params) => [
      {
        id: String(params?.[0] ?? "t-acme"),
        target_repo: repoFromId(params?.[0]),
        status: "queued",
      },
    ],
  },
  {
    match: (sql) => sql.includes("FROM lore.plans"),
    rows: (_sql, params) => [planRow(params?.[0])],
  },
  {
    match: (sql) => sql.includes("SELECT count(*)::int as count"),
    rows: () => [{ count: 0 }],
  },
];

function queryRowsFor(sql: string, params: unknown[] | undefined): unknown[] {
  const matched = QUERY_HANDLERS.find((entry) => entry.match(sql));

  return matched ? matched.rows(sql, params) : [];
}

function repoFromId(raw: unknown): string {
  const value = String(raw ?? "");

  return value.includes("secret") || value.startsWith("11111111")
    ? "other/secret"
    : "acme/app";
}

function planRow(rawId: unknown) {
  const id = String(rawId ?? PLAN_FOR_REPO["acme/app"]);

  return {
    id,
    repo: repoFromId(id),
    title: "Plan",
    type: "feature",
    template_version: 1,
    status: "draft",
    approval: null,
    current_version: 1,
    created_by: "ben",
    created_at: new Date("2026-11-18T00:00:00Z"),
    updated_at: new Date("2026-11-18T00:00:00Z"),
  };
}

function repoRows(params: unknown[] | undefined) {
  const named = typeof params?.[0] === "string" ? params[0].toLowerCase() : "";

  if (named === "other/secret") {
    return [
      {
        id: "r-secret",
        owner: "other",
        name: "secret",
        full_name: "other/secret",
        team: "platform",
        onboarded_at: new Date("2026-11-18T00:00:00Z"),
        last_ingested_at: "2026-11-18T00:00:00Z",
        onboarding_pr_url: null,
        onboarding_pr_merged: false,
        settings: {},
        outcome_stats: null,
      },
    ];
  }

  return [
    {
      id: "r-acme",
      owner: "acme",
      name: "app",
      full_name: "acme/app",
      team: "platform",
      onboarded_at: new Date("2026-11-18T00:00:00Z"),
      last_ingested_at: "2026-11-18T00:00:00Z",
      onboarding_pr_url: null,
      onboarding_pr_merged: false,
      settings: {},
      outcome_stats: null,
    },
  ];
}

const sha256 = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");

const TOKENS_BY_HASH: Record<string, unknown> = {
  [sha256(BEN_TOKEN)]: personToken("Ben", ["acme/app"], "ben"),
  [sha256(DANA_TOKEN)]: personToken("Dana", ["acme/app"], "dana"),
};

function tokenRows(params: unknown[] | undefined): unknown[] {
  const row = TOKENS_BY_HASH[String(params?.[0])];

  return row ? [row] : [];
}

function personToken(
  displayName: string,
  repos: string[],
  login = displayName,
) {
  return {
    scopes: ["admin"],
    kind: "user",
    github_id: 1000 + displayName.length,
    login,
    displayName,
    avatarUrl: null,
    repos,
    startedAt: new Date("2026-11-18T10:00:00Z"),
    expiresAt: null,
  };
}
