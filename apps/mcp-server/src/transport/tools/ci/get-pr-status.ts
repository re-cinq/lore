import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GET_PR_STATUS_INPUT } from "../pipeline/shared/pipeline-tools-schemas.js";
import { readThroughApi } from "./shared/read-through-api.js";

export function registerGetPrStatusTool(server: McpServer) {
  server.tool(
    "lore_get_pr_status",
    "Fetches live PR state from GitHub and returns a derived computed_status (merged | closed | draft | checks-failing | changes-requested | approved | open) plus CI checks and reviews. Use this for the real-time PR/CI/review verdict. Instead: lore_get_pipeline_status for the Lore task's stored status and event timeline; lore_get_ci_failures for WHAT failed and where.",
    GET_PR_STATUS_INPUT,
    prStatusHandler,
  );
}

// The live PR verdict, straight from GitHub via the API.
async function prStatusHandler({
  repo,
  pr_number,
}: {
  repo: string;
  pr_number: number;
}) {
  const params = new URLSearchParams({ repo, pr_number: String(pr_number) });

  return readThroughApi(
    "lore_get_pr_status",
    `/api/pr-status?${params}`,
    "PR status",
  );
}
