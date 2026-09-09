import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../http/zod-response.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
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

const PullFilesParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

type PullFilesParams = z.infer<typeof PullFilesParams>;

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

const GITHUB_UNCONFIGURED = "GitHub not configured";

export function pullFilesRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/pulls/{number}/files",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { params: zodValidate(PullFilesParams) },
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
  const { owner, repo, number } = request.params as unknown as PullFilesParams;

  try {
    const project = await projectFor(`${owner}/${repo}`);
    const files = await project.pulls.listFileChanges(number);

    return h.response({ files });
  } catch (err) {
    return failureResponse(err, h);
  }
}

/** 404 when GitHub has no such pull request, 424 when GitHub is unconfigured (the dependency is absent, nothing failed), 500 otherwise; a guard's refusal already carries its status. */
function failureResponse(err: unknown, h: ResponseToolkit): ResponseObject {
  rethrowBoom(err);
  enforceTrue(
    httpStatusOf(err) !== 404,
    apiError(404),
    "pull request not found",
  );
  enforceTrue(
    !errorMessage(err).startsWith(GITHUB_UNCONFIGURED),
    apiError(424),
    errorMessage(err),
  );

  return h.response({ error: errorMessage(err) }).code(500);
}

function httpStatusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}
