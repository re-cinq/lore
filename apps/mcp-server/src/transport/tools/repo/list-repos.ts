import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { proxyGetApi, textResult } from "../shared/deps.js";
import {
  NOT_CONFIGURED,
  proxyFailure,
  type ToolTextResult,
} from "./shared/proxy-failure.js";
import { apiAnswer, apiGetUrl, type ApiAnswer } from "../../api/api-types.js";

type Repo = ApiAnswer<"/api/repos">["repos"][number];

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
  { repos: Repo[]; total: number } | { failure: ToolTextResult }
> {
  const pageSize = 100;
  const repos: Repo[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchRepoPage(pageSize, offset);

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
  { pageRepos: Repo[]; total: number } | { failure: ToolTextResult };

async function fetchRepoPage(
  limit: number,
  offset: number,
): Promise<RepoPageResult> {
  const proxied = await proxyGetApi(apiGetUrl("/api/repos", { limit, offset }));

  if (!proxied.ok) {
    return {
      failure: proxyFailure("lore_list_repos", NOT_CONFIGURED, proxied),
    };
  }

  const { repos, total } = apiAnswer("/api/repos", proxied.body);

  return { pageRepos: repos, total };
}
