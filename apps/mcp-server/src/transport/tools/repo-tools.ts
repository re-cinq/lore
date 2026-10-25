import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  proxyToApi,
  proxyGetApi,
  deniedError,
  failedProxyError,
  textResult,
  type ProxyResult,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";
import {
  repoParam,
  resolveRepo,
  withRepo,
  type ServerMode,
} from "./repo-scope.js";

const NOT_CONFIGURED =
  "Repo management requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.";

const ONBOARD_REPO_INPUT = {
  full_name: z
    .string()
    .describe('"owner/repo" format; both segments must be non-empty.'),
  reonboard: z
    .boolean()
    .optional()
    .describe(
      "Update run over an already-onboarded repo: one assembly run that refreshes Lore's own files wherever they drifted (workflows, lore issue templates), adds any file newly required, realigns the instruction-written workflows, and opens ONE PR — or none when the setup is already current. Still refused while an onboard task is in flight or its onboarding PR is open.",
    ),
};

const ingestFilesInput = (mode: ServerMode) => ({
  files: z.array(z.string()).describe("Repo-relative file paths to ingest."),
  repo: repoParam(mode),
});

type ToolTextResult = ReturnType<typeof textResult>;

interface IngestCredentials {
  apiUrl: string;
  apiToken: string;
}

interface IngestOutcome {
  ingested: boolean;
  message: string;
}

export function registerRepoTools(server: McpServer, mode: ServerMode) {
  registerListReposTool(server);
  registerOnboardRepoTool(server);
  registerIngestFilesTool(server, mode);
  registerNextReadyIssueTool(server, mode);
}

function registerListReposTool(server: McpServer) {
  server.tool(
    "lore_list_repos",
    `Lists every repo onboarded into Lore as JSON ({ repos, total }) with per-repo metadata and pipeline task count. Pages through all repos automatically. Instead: to add a repo use lore_onboard_repo; to list pipeline tasks use lore_list_pipeline_tasks.`,
    {},
    async () => {
      const walked = await walkRepoPages();

      if ("failure" in walked) {
        return walked.failure;
      }
      const { repos, total } = walked;

      if (repos.length === 0) {
        return textResult(
          "No repos onboarded yet. Use lore_onboard_repo to add one.",
        );
      }

      return textResult(JSON.stringify({ repos, total }, null, 2));
    },
  );
}

async function walkRepoPages(): Promise<
  { repos: unknown[]; total: number } | { failure: ToolTextResult }
> {
  const pageSize = 100;
  const repos: unknown[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchRepoPage(pageSize, offset, repos.length);

    if ("failure" in page) {
      return page;
    }

    repos.push(...page.pageRepos);

    if (page.pageRepos.length < pageSize || repos.length >= page.total) {
      return { repos, total: page.total };
    }
  }
}

type RepoPageResult =
  { pageRepos: unknown[]; total: number } | { failure: ToolTextResult };

async function fetchRepoPage(
  limit: number,
  offset: number,
  curr: number,
): Promise<RepoPageResult> {
  const proxied = await proxyGetApi(
    `/api/repos?limit=${limit}&offset=${offset}`,
  );

  if (!proxied.ok) {
    return {
      failure: proxyFailure("lore_list_repos", NOT_CONFIGURED, proxied),
    };
  }

  const parsed = JSON.parse(proxied.body) as Record<string, unknown>;
  const pageRepos = Array.isArray(parsed.repos) ? parsed.repos : [];
  const total =
    typeof parsed.total === "number" ? parsed.total : curr + pageRepos.length;

  return { pageRepos, total };
}

function proxyFailure(
  toolName: string,
  unconfiguredText: string,
  proxied: Extract<ProxyResult, { ok: false }>,
): ToolTextResult {
  if (proxied.reason === "not_configured") {
    return textResult(unconfiguredText);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return failedProxyError(toolName, proxied);
}

function registerOnboardRepoTool(server: McpServer) {
  server.tool(
    "lore_onboard_repo",
    `Registers a new GitHub repo with Lore and spawns an onboard pipeline task: the Floor enrols the repo (labels, webhook, ingest callback, verbatim workflows) and the onboard assembly line authors AGENTS.md/PR-template/ADRs/spec from the onboarding ticket and opens the ONE PR asynchronously; returns { repo_id, task_id, status }. Refuses (HTTP 409) when the repo is already onboarded, still has its onboarding PR open, or already has an onboard task in flight — pass reonboard to regenerate missing scaffolding for an onboarded repo. Instead: to list repos use lore_list_repos; to push files into an already-onboarded repo use lore_ingest_files.`,
    ONBOARD_REPO_INPUT,
    onboardRepo,
  );
}

type OnboardArgs = { full_name: string; reonboard?: boolean };

async function onboardRepo(args: OnboardArgs): Promise<ToolTextResult> {
  const repo = args.full_name;
  const reonboard = args.reonboard;
  const proxied = await proxyToApi("/api/onboard", { repo, reonboard });

  if (proxied.ok) {
    return textResult(proxied.body);
  }

  const isConflict = proxied.reason === "unreachable" && proxied.status === 409;

  if (isConflict && proxied.body) {
    return textResult(proxied.body);
  }

  return proxyFailure("lore_onboard_repo", NOT_CONFIGURED, proxied);
}

function registerIngestFilesTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_ingest_files",
    `Fetches specific repo files from GitHub, embeds them, and writes them into Lore's context store immediately so they are searchable without waiting for nightly ingestion. Returns "Ingested N files into Lore for <repo>. M errors." Use after merging a new ADR or updated CLAUDE.md to make it searchable now. Instead: to onboard a new repo use lore_onboard_repo; to search existing content use lore_search_context or lore_assemble_context.`,
    ingestFilesInput(mode),
    async ({ files, repo }) => {
      try {
        return await withRepo({ repo }, mode, (a) =>
          ingestFiles(files, mode, a.repo),
        );
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}

async function ingestFiles(
  files: string[],
  mode: ServerMode,
  resolvedRepo: string,
) {
  const credentials = ingestCredentials();

  if (!credentials) {
    return textResult(
      "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
    );
  }
  const commit = await resolveCommitSha(resolvedRepo, mode);
  const outcome = await postIngest(credentials, files, resolvedRepo, commit);

  if (outcome.ingested) {
    invalidateCache(["lore_assemble_context"], resolvedRepo);
  }

  return textResult(outcome.message);
}

function ingestCredentials(): IngestCredentials | null {
  const { LORE_API_URL: apiUrl, LORE_INGEST_TOKEN: apiToken } = process.env;

  return apiUrl && apiToken ? { apiUrl, apiToken } : null;
}

async function resolveCommitSha(
  resolvedRepo: string,
  mode: ServerMode,
): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");

    if (resolveRepo(undefined, mode) !== resolvedRepo) {
      return "HEAD";
    }

    return execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "HEAD";
  }
}

async function postIngest(
  credentials: IngestCredentials,
  files: string[],
  resolvedRepo: string,
  commit: string,
): Promise<IngestOutcome> {
  const res = await fetch(`${credentials.apiUrl}/api/ingest`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${credentials.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ files, repo: resolvedRepo, commit }),
  });

  return parseIngestResponse(res, resolvedRepo);
}

async function parseIngestResponse(
  res: Response,
  resolvedRepo: string,
): Promise<IngestOutcome> {
  if (res.ok) {
    const result = (await res.json()) as { ingested?: number; errors?: number };

    return {
      ingested: true,
      message: `Ingested ${result.ingested || 0} files into Lore for ${resolvedRepo}. ${result.errors || 0} errors.`,
    };
  }
  const err = await res.json().catch(() => ({ error: res.statusText }));

  return {
    ingested: false,
    message: `Ingestion failed: ${(err as { error?: string }).error || res.statusText}`,
  };
}

function registerNextReadyIssueTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_next_ready_issue",
    `Returns the issue the implementation loop would pick next for a repo: number, title, url, and a \`because\` field naming the rule that selected it. Returns { issue: null, reason } when nothing is ready — never an error. Use to preview which ticket the loop would start next without dispatching it.`,
    { repo: repoParam(mode) },
    (args: { repo?: string }) => withRepo(args, mode, fetchNextReadyIssue),
  );
}

interface NextReadyResult {
  issue: Record<string, unknown> | null;
  because?: string;
  reason?: string;
}

type LoopState = { next?: Array<Record<string, unknown>>; criteria?: string[] };
async function fetchNextReadyIssue(args: {
  repo: string;
}): Promise<ToolTextResult> {
  const proxied = await proxyGetApi(
    `/api/repos/${args.repo}/implementation-loop`,
  );

  if (!proxied.ok) {
    return textResult(
      JSON.stringify({ issue: null, reason: "Could not reach Lore API." }),
    );
  }

  return textResult(
    JSON.stringify(nextReadyResult(JSON.parse(proxied.body) as LoopState)),
  );
}

function nextReadyResult(loopState: {
  next?: Array<Record<string, unknown>>;
  criteria?: string[];
}): NextReadyResult {
  const issues = loopState.next || [];
  const readyIssues = issues.filter((i) => !i.hold);

  if (readyIssues.length === 0) {
    return { issue: null, reason: "No issues ready in the backlog." };
  }

  const issue = readyIssues[0];
  const rule = loopState.criteria?.[0] || "priority";
  const because = `${rule} (unblocks: ${issue.unblocks_count || 0})`;

  return { issue, because };
}
