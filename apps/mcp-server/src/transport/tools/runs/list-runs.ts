import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import {
  invalidRepoRefusal,
  resolveRepo,
  type ServerMode,
} from "../shared/repo-scope.js";
import { queryString, readRun } from "./shared/run-read.js";

export const LIST_RUNS_DESCRIPTION =
  "Lists assembly-line runs on the floor, newest first, a page at a time, returning {runs, next_cursor}; each run carries its id, line, status, repository and stages. Pass next_cursor back as cursor for the next page. Instead: lore_get_run for one run's stations, Definition of Done and tokens.";

const LIST_RUNS_INPUT = {
  repo: z
    .string()
    .optional()
    .describe(
      "'owner/repo'. Defaults to the git remote's repository on a laptop and to every repository on the agent gateway.",
    ),
  status: z
    .string()
    .optional()
    .describe("Only runs in this status, e.g. running, failed, succeeded."),
  line: z
    .string()
    .optional()
    .describe("Only runs of this assembly line, e.g. implementation-loop."),
  cursor: z.string().optional().describe("next_cursor from the previous page."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Runs per page, 1 to 100."),
};

type ListRunsArgs = {
  repo?: string;
  status?: string;
  line?: string;
  cursor?: string;
  limit?: number;
};

export function registerListRunsTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_list_runs",
    LIST_RUNS_DESCRIPTION,
    LIST_RUNS_INPUT,
    (args) => listRuns(args, mode),
  );
}

function listRuns(args: ListRunsArgs, mode: ServerMode) {
  const refusal = invalidRepoRefusal(args.repo);

  if (refusal) {
    return Promise.resolve(textResult(refusal));
  }
  const query = queryString({
    ...args,
    repo: resolveRepo(args.repo, mode) ?? undefined,
  });

  return readRun({
    tool: "lore_list_runs",
    op: "listing runs",
    load: (get) => get(`/api/floor-runs${query}`),
  });
}
