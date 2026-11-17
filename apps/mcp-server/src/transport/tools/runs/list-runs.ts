import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AssemblyRunStatusSchema } from "@re-cinq/lore-shared/models/assembly-run.js";
import { textResult } from "../shared/deps.js";
import {
  invalidRepoRefusal,
  resolveRepo,
  type ServerMode,
} from "../shared/repo-scope.js";
import { queryString, readRun } from "./shared/run-read.js";

export const LIST_RUNS_DESCRIPTION =
  "Lists assembly-line runs on the floor, newest first, a page at a time, returning {runs, next_cursor}; each run carries its id, line, status, repository and stages. Pass next_cursor back as cursor for the next page; repo 'all' lists every repository. Instead: lore_get_run for one run's stations and Definition of Done.";

const LIST_RUNS_INPUT = {
  repo: z
    .string()
    .optional()
    .describe(
      "'owner/repo', or 'all' for every repository. Defaults to the git remote's repository on a laptop and to every repository on the agent gateway.",
    ),
  status: AssemblyRunStatusSchema.optional().describe(
    "Only runs in this status.",
  ),
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

const ALL_REPOS = "all";

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
  if (args.repo === ALL_REPOS) {
    return runsPage({ ...args, repo: undefined });
  }
  const refusal = invalidRepoRefusal(args.repo);

  if (refusal) {
    return Promise.resolve(textResult(refusal));
  }

  return runsPage({ ...args, repo: resolveRepo(args.repo, mode) ?? undefined });
}

function runsPage(args: ListRunsArgs) {
  return readRun({
    tool: "lore_list_runs",
    op: "listing runs",
    load: (get) => get(`/api/floor-runs${queryString(args)}`),
  });
}
