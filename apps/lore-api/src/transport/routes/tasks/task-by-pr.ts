import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { parseTrailers } from "@re-cinq/lore-shared";
import { getOctokit } from "../../../outbound/github-client.js";
import { bearerScope } from "../../http/bearer-scope.js";

const LORE_TASK_TRAILER_RE = /^Lore-Task:\s*([0-9a-f-]+)\s*$/im;

/** Which task a PR belongs to, and where the trailer was found. */
const TaskByPrSchema = z.object({
  task_id: z.string(),
  trailer_source: z.enum(["db", "pr_body", "final_commit"]),
});

async function taskIdFromDb(
  pool: Pool,
  repo: string,
  prNumber: number,
): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM pipeline.tasks
         WHERE target_repo = $1 AND pr_number = $2
         LIMIT 1`,
      [repo, prNumber],
    );

    return rows.length > 0 ? rows[0].id : null;
  } catch (err) {
    console.error("[by-pr] DB lookup failed:", err);

    return null;
  }
}

type PrTrailerResult = {
  task_id: string;
  trailer_source: "pr_body" | "final_commit";
} | null;

async function taskIdFromGithub(
  owner: string,
  repoName: string,
  prNumber: number,
): Promise<PrTrailerResult> {
  const { pulls, git } = (await getOctokit()).rest;
  const { data: pr } = await pulls.get({
    owner,
    repo: repoName,
    pull_number: prNumber,
  });

  const fromBody = pr.body?.match(LORE_TASK_TRAILER_RE);

  if (fromBody) {
    return { task_id: fromBody[1], trailer_source: "pr_body" };
  }

  // Final commit on the PR head branch.
  const commit = await git.getCommit({
    owner,
    repo: repoName,
    commit_sha: pr.head.sha,
  });
  const trailers = parseTrailers(commit.data.message);
  const taskId = trailers?.taskId;

  return taskId ? { task_id: taskId, trailer_source: "final_commit" } : null;
}

/** Resolves a PR back to the task that opened it. In dark-factory mode the `Lore-Task:` trailer is the only cross-reference, so this read is what makes a PR traceable. */
/** The PR this read is about. The number is checked against digits explicitly: hapi's `{number}` segment does not constrain the way the legacy matcher did, and an unchecked parse would carry a NaN into the query rather than refusing here. */
function prTarget(request: Request): {
  owner: string;
  repoName: string;
  prNumber: number;
} {
  enforceTrue(
    /^[0-9]+$/.test(request.params.number),
    apiError(400),
    "invalid pr number",
  );

  return {
    owner: request.params.owner,
    repoName: request.params.repo,
    prNumber: Number.parseInt(request.params.number, 10),
  };
}

async function serveTaskByPr(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), "database unavailable");
  const { owner, repoName, prNumber } = prTarget(request);
  // The DB first: it holds the link for every PR Lore opened itself, and the trailer parse below is for PRs it did not.
  const dbTaskId = await taskIdFromDb(pool, `${owner}/${repoName}`, prNumber);

  if (dbTaskId) {
    return h.response({ task_id: dbTaskId, trailer_source: "db" });
  }

  // Not in the DB: read the PR body and its final commit for a `Lore-Task:` trailer, which is the only cross-reference a dark-factory PR carries.
  try {
    const fromGithub = await taskIdFromGithub(owner, repoName, prNumber);

    return fromGithub
      ? h.response(fromGithub)
      : h.response({ error: "no_trailer_found" }).code(404);
  } catch (err) {
    enforceTrue(
      (err as { status?: number }).status !== 404,
      apiError(404),
      "pr_not_found",
    );
    console.error("[by-pr] GitHub fallback failed:", err);

    return h.response({ error: "github_api" }).code(500);
  }
}

export function taskByPrRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks/by-pr/{owner}/{repo}/{number}",
    options: zodResponse(bearerScope("read"), TaskByPrSchema, {
      name: "TaskByPr",
      description: "The task a pull request belongs to",
      errors: [404],
    }),
    handler: (request, h) => serveTaskByPr(getPool, request, h),
  };
}
