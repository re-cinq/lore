import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentRepo } from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import {
  ToolDeps,
  proxyToApi,
  proxyGetApi,
  deniedError,
  unreachableError,
} from "./deps.js";
import { invalidate as invalidateCache } from "@re-cinq/lore-server-core/platform/proxy-cache.js";

const NOT_CONFIGURED =
  "Repo management requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.";

export function registerRepoTools(server: McpServer, _deps: ToolDeps) {
  server.tool(
    "lore_list_repos",
    `Lists every repo onboarded into Lore as JSON ({ repos, total }) with per-repo metadata and pipeline task count. Pages through all repos automatically. Instead: to add a repo use lore_onboard_repo; to list pipeline tasks use lore_list_pipeline_tasks.`,
    {},
    async () => {
      // The API caps a single response at 100, so walk the offset until every
      // onboarded repo is collected — an org with >100 repos would otherwise
      // silently see only the first page.
      const pageSize = 100;
      const repos: unknown[] = [];
      let total: number;

      for (let offset = 0; ; offset += pageSize) {
        const proxied = await proxyGetApi(
          `/api/repos?limit=${pageSize}&offset=${offset}`,
        );

        if (!proxied.ok) {
          if (proxied.reason === "not_configured") {
            return {
              content: [{ type: "text" as const, text: NOT_CONFIGURED }],
            };
          }

          if (proxied.reason === "denied") {
            return deniedError("lore_list_repos", proxied.detail);
          }

          return unreachableError("lore_list_repos", proxied.detail);
        }
        const body = JSON.parse(proxied.body) as {
          repos?: unknown[];
          total?: number;
        };
        const page = Array.isArray(body.repos) ? body.repos : [];

        repos.push(...page);
        total = typeof body.total === "number" ? body.total : repos.length;

        if (page.length < pageSize || repos.length >= total) {
          break;
        }
      }

      if (repos.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No repos onboarded yet. Use lore_onboard_repo to add one.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ repos, total }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "lore_onboard_repo",
    `Registers a new GitHub repo with Lore and spawns an onboard pipeline task that authors CLAUDE.md/AGENTS.md/PR-template and opens a PR asynchronously; returns { repo_id, task_id, status }. Re-onboarding an existing repo refreshes onboarded_at. Instead: to list repos use lore_list_repos; to push files into an already-onboarded repo use lore_ingest_files.`,
    {
      full_name: z
        .string()
        .describe('"owner/repo" format; both segments must be non-empty.'),
    },
    async ({ full_name }) => {
      const proxied = await proxyToApi("/api/onboard", { repo: full_name });

      if (proxied.ok) {
        return { content: [{ type: "text" as const, text: proxied.body }] };
      }

      if (proxied.reason === "not_configured") {
        return { content: [{ type: "text" as const, text: NOT_CONFIGURED }] };
      }

      if (proxied.reason === "denied") {
        return deniedError("lore_onboard_repo", proxied.detail);
      }

      return unreachableError("lore_onboard_repo", proxied.detail);
    },
  );

  server.tool(
    "lore_ingest_files",
    `Fetches specific repo files from GitHub, embeds them, and writes them into Lore's context store immediately so they are searchable without waiting for nightly ingestion. Returns "Ingested N files into Lore for <repo>. M errors." Use after merging a new ADR or updated CLAUDE.md to make it searchable now. Instead: to onboard a new repo use lore_onboard_repo; to search existing content use lore_search_context or lore_assemble_context.`,
    {
      files: z
        .array(z.string())
        .describe("Repo-relative file paths to ingest."),
      repo: z
        .string()
        .optional()
        .describe(
          '"owner/repo" format. Auto-detected from cwd git remote when omitted.',
        ),
    },
    async ({ files, repo }) => {
      try {
        const resolvedRepo = repo || detectCurrentRepo();

        if (!resolvedRepo) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').",
              },
            ],
          };
        }

        // Proxy to GKE ingest API
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;

        if (!apiUrl || !apiToken) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure.",
              },
            ],
          };
        }

        // Get the latest commit SHA — only use local HEAD if repo matches
        let commit = "HEAD";

        try {
          const { execSync } = await import("node:child_process");
          const localRepo = detectCurrentRepo();

          if (localRepo === resolvedRepo) {
            commit = execSync("git rev-parse HEAD", {
              encoding: "utf-8",
              timeout: 5000,
            }).trim();
          }
          // For other repos, "HEAD" tells GitHub to use the default branch
        } catch {
          // ignore; fall through
        }

        const res = await fetch(`${apiUrl}/api/ingest`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ files, repo: resolvedRepo, commit }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));

          return {
            content: [
              {
                type: "text" as const,
                text: `Ingestion failed: ${(err as any).error || res.statusText}`,
              },
            ],
          };
        }

        const result = (await res.json()) as any;

        invalidateCache(["lore_assemble_context"], resolvedRepo);

        return {
          content: [
            {
              type: "text" as const,
              text: `Ingested ${result.ingested || 0} files into Lore for ${resolvedRepo}. ${result.errors || 0} errors.`,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err.message}` }],
        };
      }
    },
  );
}
