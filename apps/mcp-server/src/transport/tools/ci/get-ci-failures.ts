import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { textResult } from "../shared/deps.js";
import {
  repoParam,
  resolveBranch,
  withRepo,
  type ServerMode,
} from "../shared/repo-scope.js";
import { readThroughApi } from "./shared/read-through-api.js";

const BRANCH_DESCRIPTION: Record<ServerMode, string> = {
  full: "Branch name. Defaults to the checked-out branch of the current directory.",
  agent:
    "Branch name, e.g. the output of `git branch --show-current`. Required unless pr_number is given: this server has no checkout to read it from.",
};

const CI_FAILURES_INPUT = {
  pr_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Alternative to branch: the pull request whose head branch to report on.",
    ),
};

const NO_BRANCH =
  "Could not detect the branch. Specify branch (e.g. 'feat/x') or pr_number.";

export function registerGetCiFailuresTool(server: McpServer, mode: ServerMode) {
  server.tool(
    "lore_get_ci_failures",
    "What CI said about a branch: the sha it judged (the newest commit not marked [skip ci]), the conclusion (success | failure | pending | none), and every failed check with its annotations (path:line message — the file to open), the steps that failed, and the failing step's log tail. A failure's `unreadable` lists the reads GitHub refused, as `what (status)`: an empty part beside an entry there could not be read, which is a permission gap to report and not a silent job. Call this before reproducing any build: CI already ran it. Instead: lore_get_ci_job_log for more of one job's log; lore_get_pr_status for the pull request's review state.",
    {
      repo: repoParam(mode),
      branch: z.string().optional().describe(BRANCH_DESCRIPTION[mode]),
      ...CI_FAILURES_INPUT,
    },
    (args) => withRepo(args, mode, (a) => ciFailuresHandler(a, mode)),
  );
}

async function ciFailuresHandler(
  args: {
    repo: string;
    branch?: string;
    pr_number?: number;
  },
  mode: ServerMode,
) {
  const target = ciTarget(args, mode);

  if (!target) {
    return textResult(NO_BRANCH);
  }

  return readThroughApi(
    "lore_get_ci_failures",
    `/api/repos/${args.repo}/ci-failures?${target}`,
    "CI failures",
  );
}

/** The query naming what to report on: a pull request number when given, else the branch given or checked out. */
function ciTarget(
  args: {
    branch?: string;
    pr_number?: number;
  },
  mode: ServerMode,
): string | null {
  if (args.pr_number !== undefined) {
    return new URLSearchParams({
      pr_number: String(args.pr_number),
    }).toString();
  }
  const branch = resolveBranch(args.branch, mode);

  return branch ? new URLSearchParams({ branch }).toString() : null;
}
