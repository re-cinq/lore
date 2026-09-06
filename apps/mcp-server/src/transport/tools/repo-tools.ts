import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import {
  proxyToApi,
  proxyGetApi,
  deniedError,
  unreachableError,
  textResult,
  type ProxyResult,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";

const NOT_CONFIGURED =
  "Repo management requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
const ONBOARD_REPO_INPUT = {
  full_name: z
    .string()
    .describe('"owner/repo" format; both segments must be non-empty.'),
  reonboard: z
    .boolean()
    .optional()
    .describe(
      "Repair pass over an already-onboarded repo: regenerates only the scaffolding it is missing. Still refused while an onboard task is in flight or its onboarding PR is open.",
    ),
};

const INGEST_FILES_INPUT = {
  files: z.array(z.string()).describe("Repo-relative file paths to ingest."),
  repo: z
    .string()
    .optional()
    .describe(
      '"owner/repo" format. Auto-detected from cwd git remote when omitted.',
    ),
};

export function registerRepoTools(server: McpServer) {
  registerListReposTool(server);
  registerOnboardRepoTool(server);
  registerIngestFilesTool(server);
}

type ToolTextResult = ReturnType<typeof textResult>;

// Maps a failed ProxyResult to the MCP text result callers surface — the same three reasons every proxying tool handles.
function proxyFailure(
  toolName: string,
  notConfiguredText: string,
  proxied: Extract<ProxyResult, { ok: false }>,
): ToolTextResult {
  if (proxied.reason === "not_configured") {
    return textResult(notConfiguredText);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return unreachableError(toolName, proxied.detail);
}

// One /api/repos page: repos plus the running total, computed against how many repos are banked so far.
function repoPage(
  body: string,
  bankedSoFar: number,
): { repos: unknown[]; total: number } {
  const parsed = JSON.parse(body) as { repos?: unknown[]; total?: number };
  const repos = Array.isArray(parsed.repos) ? parsed.repos : [];
  const total =
    typeof parsed.total === "number"
      ? parsed.total
      : bankedSoFar + repos.length;

  return { repos, total };
}

function registerListReposTool(server: McpServer) {
  server.tool(
    "lore_list_repos",
    `Lists every repo onboarded into Lore as JSON ({ repos, total }) with per-repo metadata and pipeline task count. Pages through all repos automatically. Instead: to add a repo use lore_onboard_repo; to list pipeline tasks use lore_list_pipeline_tasks.`,
    {},
    async () => {
      // The API caps a single response at 100, so walk the offset — an org with >100 repos would otherwise silently see only the first page.
      const pageSize = 100;
      const repos: unknown[] = [];
      let total: number;

      for (let offset = 0; ; offset += pageSize) {
        const proxied = await proxyGetApi(
          `/api/repos?limit=${pageSize}&offset=${offset}`,
        );

        if (!proxied.ok) {
          return proxyFailure("lore_list_repos", NOT_CONFIGURED, proxied);
        }

        const page = repoPage(proxied.body, repos.length);

        repos.push(...page.repos);
        total = page.total;

        if (page.repos.length < pageSize || repos.length >= total) {
          break;
        }
      }

      if (repos.length === 0) {
        return textResult(
          "No repos onboarded yet. Use lore_onboard_repo to add one.",
        );
      }

      return textResult(JSON.stringify({ repos, total }, null, 2));
    },
  );
}

function registerOnboardRepoTool(server: McpServer) {
  server.tool(
    "lore_onboard_repo",
    `Registers a new GitHub repo with Lore and spawns an onboard pipeline task that authors CLAUDE.md/AGENTS.md/PR-template and opens a PR asynchronously; returns { repo_id, task_id, status }. Refuses (HTTP 409) when the repo is already onboarded, still has its onboarding PR open, or already has an onboard task in flight — pass reonboard to regenerate missing scaffolding for an onboarded repo. Instead: to list repos use lore_list_repos; to push files into an already-onboarded repo use lore_ingest_files.`,
    ONBOARD_REPO_INPUT,
    async ({ full_name, reonboard }) => {
      const proxied = await proxyToApi("/api/onboard", {
        repo: full_name,
        reonboard,
      });

      if (proxied.ok) {
        return textResult(proxied.body);
      }

      if (proxied.reason === "not_configured") {
        return textResult(NOT_CONFIGURED);
      }

      if (proxied.reason === "denied") {
        return deniedError("lore_onboard_repo", proxied.detail);
      }

      // A 409 is the guard refusing a duplicate, not an outage — return the body verbatim so the caller keeps `blocked`/`task_id` to poll or pass reonboard.
      if (proxied.status === 409 && proxied.body) {
        return textResult(proxied.body);
      }

      return unreachableError("lore_onboard_repo", proxied.detail);
    },
  );
}

interface IngestCredentials {
  apiUrl: string;
  apiToken: string;
}

function ingestCredentials(): IngestCredentials | null {
  const apiUrl = process.env.LORE_API_URL;
  const apiToken = process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !apiToken) {
    return null;
  }

  return { apiUrl, apiToken };
}

// The local HEAD commit only stands in for the target repo when the caller's cwd git remote actually IS that repo; otherwise "HEAD" tells GitHub to resolve the default branch.
async function resolveCommitSha(resolvedRepo: string): Promise<string> {
  try {
    const { execSync } = await import("node:child_process");

    if (detectCurrentRepo() !== resolvedRepo) {
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

interface IngestOutcome {
  ingested: boolean;
  message: string;
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

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));

    return {
      ingested: false,
      message: `Ingestion failed: ${(err as { error?: string }).error || res.statusText}`,
    };
  }

  const result = (await res.json()) as { ingested?: number; errors?: number };

  return {
    ingested: true,
    message: `Ingested ${result.ingested || 0} files into Lore for ${resolvedRepo}. ${result.errors || 0} errors.`,
  };
}

function registerIngestFilesTool(server: McpServer) {
  server.tool(
    "lore_ingest_files",
    `Fetches specific repo files from GitHub, embeds them, and writes them into Lore's context store immediately so they are searchable without waiting for nightly ingestion. Returns "Ingested N files into Lore for <repo>. M errors." Use after merging a new ADR or updated CLAUDE.md to make it searchable now. Instead: to onboard a new repo use lore_onboard_repo; to search existing content use lore_search_context or lore_assemble_context.`,
    INGEST_FILES_INPUT,
    async ({ files, repo }) => {
      try {
        const resolvedRepo = repo || detectCurrentRepo();

        if (!resolvedRepo) {
          return textResult(
            "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
          );
        }

        const credentials = ingestCredentials();

        if (!credentials) {
          return textResult(
            "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
          );
        }

        const commit = await resolveCommitSha(resolvedRepo);
        const outcome = await postIngest(
          credentials,
          files,
          resolvedRepo,
          commit,
        );

        if (outcome.ingested) {
          invalidateCache(["lore_assemble_context"], resolvedRepo);
        }

        return textResult(outcome.message);
      } catch (err) {
        return textResult(`Error: ${errorMessage(err)}`);
      }
    },
  );
}
