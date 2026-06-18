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
    `Lists every repo onboarded into Lore. Returns a JSON array of rows from lore.repos (id, owner, name, full_name, team, onboarded_at, last_ingested_at, onboarding_pr_url, onboarding_pr_merged, settings) each annotated with an integer task_count (pipeline tasks targeting that repo), ordered newest-onboarded first.
Use this to inspect the Lore deployment's repo registry and per-repo pipeline activity. To ADD a new repo use lore_onboard_repo instead; this tool only reads. To list pipeline TASKS rather than repos, use lore_list_pipeline_tasks.
Runs against the shared backend Postgres directly and requires LORE_DB_HOST to be set; it does not proxy over LORE_API_URL and is unavailable in local stdio mode without a DB. Read-only, no writes, not cached. Takes no parameters. Returns guidance text when the DB is unset or when no repos are onboarded yet.`,
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
    `Onboards a GitHub repo into Lore from a single owner/repo argument. Upserts the registry row in lore.repos (re-onboarding just refreshes onboarded_at) and spawns an 'onboard' pipeline task; returns JSON { repo_id, task_id, status: 'onboarding-agent-spawned' }. The actual branch + CLAUDE.md/AGENTS.md/PR-template files and the onboarding PR are authored later by the spawned agent task, NOT synchronously by this call.
Use this once to register a brand-new repo with Lore. To merely LIST already-onboarded repos use lore_list_repos instead; to push specific files into an already-onboarded repo's context store use lore_ingest_files.
Mutates: writes an upsert to lore.repos and inserts a task into pipeline.tasks. Runs against the shared backend Postgres directly and requires LORE_DB_HOST; it does not proxy over LORE_API_URL. Never throws — returns guidance text when the DB is unset or the name is malformed.`,
    {
      full_name: z.string().describe('Target GitHub repository in "owner/repo" format; both segments must be non-empty or the call returns a malformed-name error. Required, no default. Example: "re-cinq/lore".'),
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
    `Fetches specific repo files from GitHub, embeds them, and writes them into Lore's context store on demand so they become searchable immediately via lore_search_context (without waiting for nightly ingestion). Returns a text summary "Ingested N files into Lore for <repo>. M errors."
Use this right after merging an important file (a new ADR, an updated CLAUDE.md) to make it searchable now. This is NOT for onboarding a repo (use lore_onboard_repo) and NOT for reading/searching content (use lore_search_context or lore_assemble_context).
Mutates the context store (the GKE /api/ingest route owns chunking + Vertex embedding + chunk inserts) and invalidates the lore_assemble_context read cache for the repo. Runs locally in stdio mode and PROXIES the embed work to the shared backend over LORE_API_URL — it requires both LORE_API_URL and LORE_INGEST_TOKEN (run install.sh to configure) and does not touch Postgres in this process. The commit ingested is the local HEAD only when the resolved repo matches the cwd repo; otherwise GitHub's default branch is used. Never throws — returns guidance text on missing repo/config or a failed proxy call.`,
    {
      files: z.array(z.string()).describe('Repo-relative file paths to ingest, each resolved against the repo\'s commit/default branch. Required, no default. Example: ["CLAUDE.md", "adrs/ADR-001.md", "src/auth.ts"].'),
      repo: z.string().optional().describe('Target repository in "owner/repo" format. Optional; when omitted it is auto-detected from the current directory\'s git remote, and the call fails with a detect-repo message if detection returns nothing. Example: "re-cinq/my-service".'),
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
