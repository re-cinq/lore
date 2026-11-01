import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { proxyGetApi, textResult } from "../shared/deps.js";
import {
  NOT_CONFIGURED,
  proxyFailure,
  type ToolTextResult,
} from "./shared/proxy-failure.js";

export function registerListReposTool(server: McpServer) {
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
