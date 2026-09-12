import { errorMessage } from "@re-cinq/lore-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";
import {
  deniedError,
  unconfiguredError,
  textResult,
  proxyGetApi,
  type ProxyResult,
} from "./deps.js";
import { GET_PR_STATUS_INPUT } from "./pipeline-tools-schemas.js";

// The CI reads: what GitHub Actions said about a branch, and one job's log. Served in agent mode too, so a pod repairing a red build reads the verdict instead of reproducing the build — run 997026f5 rebuilt its whole workspace to learn one lint error, and died at 1Gi doing it.

const REPO_PARAM = z
  .string()
  .optional()
  .describe("'owner/repo'. Auto-detected from the git remote when omitted.");

const CI_FAILURES_INPUT = {
  repo: REPO_PARAM,
  branch: z
    .string()
    .optional()
    .describe(
      "Branch name. Defaults to the checked-out branch of the current directory, so a pod on its own branch passes nothing.",
    ),
  pr_number: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Alternative to branch: the pull request whose head branch to report on.",
    ),
};

/** The most lines one log read returns. */
const MAX_TAIL = 2000;

/** Lines returned when the caller names no tail. */
const DEFAULT_TAIL = 200;

const CI_JOB_LOG_INPUT = {
  repo: REPO_PARAM,
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

const NO_REPO =
  "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').";
const NO_BRANCH =
  "Could not detect the branch. Specify branch (e.g. 'feat/x') or pr_number.";

export function registerCiTools(server: McpServer) {
  registerGetCiFailuresTool(server);
  registerGetCiJobLogTool(server);
  registerGetPrStatusTool(server);
}

function registerGetCiFailuresTool(server: McpServer) {
  server.tool(
    "lore_get_ci_failures",
    "What CI said about a branch: the sha it judged (the newest commit not marked [skip ci]), the conclusion (success | failure | pending | none), and every failed check with its annotations (path:line message — the file to open), the steps that failed, and the failing step's log tail. Call this before reproducing any build: CI already ran it. Instead: lore_get_ci_job_log for more of one job's log; lore_get_pr_status for the pull request's review state.",
    CI_FAILURES_INPUT,
    ciFailuresHandler,
  );
}

async function ciFailuresHandler(args: {
  repo?: string;
  branch?: string;
  pr_number?: number;
}) {
  const repo = args.repo ?? detectCurrentRepo();

  if (!repo) {
    return textResult(NO_REPO);
  }
  const target = ciTarget(args);

  if (!target) {
    return textResult(NO_BRANCH);
  }

  return readThroughApi(
    "lore_get_ci_failures",
    `/api/repos/${repo}/ci-failures?${target}`,
    "CI failures",
  );
}

/** The query naming what to report on: a pull request number when given, else the branch given or checked out. */
function ciTarget(args: {
  branch?: string;
  pr_number?: number;
}): string | null {
  if (args.pr_number !== undefined) {
    return new URLSearchParams({
      pr_number: String(args.pr_number),
    }).toString();
  }
  const branch = args.branch ?? detectCurrentBranch();

  return branch ? new URLSearchParams({ branch }).toString() : null;
}

function registerGetCiJobLogTool(server: McpServer) {
  server.tool(
    "lore_get_ci_job_log",
    "The tail of one GitHub Actions job's log, timestamps stripped, optionally filtered to lines containing grep. Use it when a failure from lore_get_ci_failures needs more than its annotations and tail — never to re-run the job locally. Instead: lore_get_ci_failures to find the job_id.",
    CI_JOB_LOG_INPUT,
    ciJobLogHandler,
  );
}

async function ciJobLogHandler(args: {
  repo?: string;
  job_id: number;
  tail?: number;
  grep?: string;
}) {
  const repo = args.repo ?? detectCurrentRepo();

  if (!repo) {
    return textResult(NO_REPO);
  }
  const query = new URLSearchParams({
    tail: String(args.tail ?? DEFAULT_TAIL),
    ...(args.grep ? { grep: args.grep } : {}),
  });

  return readThroughApi(
    "lore_get_ci_job_log",
    `/api/repos/${repo}/ci-jobs/${args.job_id}/log?${query}`,
    "the CI job log",
  );
}

function registerGetPrStatusTool(server: McpServer) {
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

/** One GET through the API, pretty-printed; a read with no local fallback, so the server's own reason is surfaced plainly rather than the write-oriented "unreachable" copy. */
async function readThroughApi(toolName: string, path: string, what: string) {
  try {
    const proxied = await proxyGetApi(path);

    return proxied.ok
      ? textResult(JSON.stringify(JSON.parse(proxied.body), null, 2))
      : readRefusal(toolName, what, proxied);
  } catch (err) {
    return textResult(`Error reading ${what}: ${errorMessage(err)}`);
  }
}

function readRefusal(
  toolName: string,
  what: string,
  proxied: Exclude<ProxyResult, { ok: true }>,
) {
  if (proxied.reason === "not_configured") {
    return unconfiguredError(`reading ${what}`);
  }

  if (proxied.reason === "denied") {
    return deniedError(toolName, proxied.detail);
  }

  return textResult(
    `Could not read ${what} from the Lore API: ${proxied.detail}`,
  );
}
