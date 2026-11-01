import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { repoParam, withRepo, type ServerMode } from "../shared/repo-scope.js";
import { readThroughApi } from "./shared/read-through-api.js";

/** The most lines one log read returns. */
const MAX_TAIL = 2000;

/** Lines returned when the caller names no tail. */
const DEFAULT_TAIL = 200;

const CI_JOB_LOG_INPUT = {
  job_id: z
    .number()
    .int()
    .positive()
    .describe("The job_id of a failure reported by lore_get_ci_failures."),
  tail: z
    .number()
    .int()
    .min(1)
    .max(MAX_TAIL)
    .optional()
    .describe(
      `Last N lines to return (default ${DEFAULT_TAIL}, max ${MAX_TAIL}).`,
    ),
  grep: z
    .string()
    .optional()
    .describe(
      "Case-insensitive substring; only matching lines are kept, before the tail is taken. 'error' finds a lint or typecheck report's findings.",
    ),
};

export function registerGetCiJobLogTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_get_ci_job_log",
    "The tail of one GitHub Actions job's log, timestamps stripped. With grep, only the lines containing it are kept and the tail is taken from those. Use it when a failure from lore_get_ci_failures needs more than its annotations and tail — never to re-run the job locally. Instead: lore_get_ci_failures to find the job_id.",
    { repo: repoParam(mode), ...CI_JOB_LOG_INPUT },
    (args) => withRepo(args, mode, ciJobLogHandler),
  );
}

async function ciJobLogHandler(args: {
  repo: string;
  job_id: number;
  tail?: number;
  grep?: string;
}) {
  const query = new URLSearchParams({
    tail: String(args.tail ?? DEFAULT_TAIL),
    ...(args.grep ? { grep: args.grep } : {}),
  });

  return readThroughApi(
    "lore_get_ci_job_log",
    `/api/repos/${args.repo}/ci-jobs/${args.job_id}/log?${query}`,
    "the CI job log",
  );
}
