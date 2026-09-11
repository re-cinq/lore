import { zodResponse } from "../../http/zod-response.js";
// Server-side because the per-file patch read needs GitHub App credentials; the run page's diff drawer reads through here.

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { RepoNumberParams, githubFailureResponse } from "./github-read.js";

// A GitHub read, not a table read, so this shape is stated rather than derived; mirrors `PullFileChange` in @re-cinq/lore-shared.
const PullFilesSchema = z.object({
  files: z.array(
    z.object({
      filename: z.string(),
      status: z.string(),
      additions: z.number(),
      deletions: z.number(),
      patch: z.string().nullable(),
      previousFilename: z.string().optional(),
    }),
  ),
});

export function pullFilesRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/pulls/{number}/files",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { params: zodValidate(RepoNumberParams) },
      },
      PullFilesSchema,
      {
        name: "PullFiles",
        description: "Every changed file on a PR with its unified patch",
        errors: [400, 404],
      },
    ),
    handler: (request, h) => servePullFiles(request, h),
  };
}

/** Every changed file on one PR with its unified patch. */
async function servePullFiles(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo, number } = request.params as unknown as RepoNumberParams;

  try {
    const project = await projectFor(`${owner}/${repo}`);
    const files = await project.pulls.listFileChanges(number);

    return h.response({ files });
  } catch (err) {
    return githubFailureResponse(err, h, "pull request");
  }
}
