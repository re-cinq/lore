import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getOnboardedReposWithCounts,
  onboardRepo,
} from "../../features/repo/repo-onboard.js";
import { detectCurrentRepo } from "../../features/repo/repo-detect.js";
import { ToolDeps } from "./deps.js";
import { invalidate as invalidateCache } from "../../platform/proxy-cache.js";

export function registerRepoTools(server: McpServer, deps: ToolDeps) {
  const { getPool } = deps;

  server.tool(
    "lore_list_repos",
    "Returns all onboarded repos from lore.repos with pipeline task counts.",
    {},
    async () => {
      try {
        if (!process.env.LORE_DB_HOST) {
          return { content: [{ type: "text" as const, text: "Repo management requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const repos = await getOnboardedReposWithCounts(getPool()!);
        if (repos.length === 0) {
          return { content: [{ type: "text" as const, text: "No repos onboarded yet. Use lore_onboard_repo to add one." }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(repos, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error listing repos: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_onboard_repo",
    "Onboard a GitHub repo: creates branch with CLAUDE.md, AGENTS.md and PR template, opens a PR, and registers the repo in lore.repos.",
    {
      full_name: z.string().describe('Repository in "owner/repo" format (e.g., "re-cinq/lore").'),
    },
    async ({ full_name }) => {
      try {
        if (!process.env.LORE_DB_HOST) {
          return { content: [{ type: "text" as const, text: "Repo onboarding requires PostgreSQL (LORE_DB_HOST not set)." }] };
        }
        const result = await onboardRepo(getPool()!, full_name);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error onboarding repo: ${err.message}` }] };
      }
    }
  );

  server.tool(
    "lore_ingest_files",
    "Manually ingest files from a repo into Lore's context store. Use this to make specific files searchable via lore_search_context. The files are fetched from GitHub and embedded.",
    {
      files: z.array(z.string()).describe('File paths to ingest (e.g., ["CLAUDE.md", "adrs/ADR-001.md", "src/auth.ts"])'),
      repo: z.string().optional().describe('Repository in "owner/repo" format. Auto-detected from git remote if omitted.'),
    },
    async ({ files, repo }) => {
      try {
        const resolvedRepo = repo || detectCurrentRepo();
        if (!resolvedRepo) {
          return { content: [{ type: "text" as const, text: "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service')." }] };
        }

        // Proxy to GKE ingest API
        const apiUrl = process.env.LORE_API_URL;
        const apiToken = process.env.LORE_INGEST_TOKEN;
        if (!apiUrl || !apiToken) {
          return { content: [{ type: "text" as const, text: "Ingestion requires LORE_API_URL + LORE_INGEST_TOKEN. Run install.sh to configure." }] };
        }

        // Get the latest commit SHA — only use local HEAD if repo matches
        let commit = "HEAD";
        try {
          const { execSync } = await import("node:child_process");
          const localRepo = detectCurrentRepo();
          if (localRepo === resolvedRepo) {
            commit = execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
          }
          // For other repos, "HEAD" tells GitHub to use the default branch
        } catch {}

        const res = await fetch(`${apiUrl}/api/ingest`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ files, repo: resolvedRepo, commit }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Ingestion failed: ${(err as any).error || res.statusText}` }] };
        }

        const result = await res.json() as any;
        invalidateCache(["lore_assemble_context"], resolvedRepo);
        return { content: [{ type: "text" as const, text: `Ingested ${result.ingested || 0} files into Lore for ${resolvedRepo}. ${result.errors || 0} errors.` }] };
      } catch (err: any) {
        return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
      }
    }
  );
}
