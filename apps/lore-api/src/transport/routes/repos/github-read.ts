import type { ResponseObject, ResponseToolkit } from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";

// What the repo routes that read one numbered GitHub thing (a pull request's files, an issue) share: the path they name it by and how a failed read answers.

export const RepoNumberParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

export type RepoNumberParams = z.infer<typeof RepoNumberParams>;

const GITHUB_UNCONFIGURED = "GitHub not configured";

/** A failed GitHub read as an HTTP answer: 404 when GitHub has no such `resource`, 424 when GitHub is unconfigured (the dependency is absent, nothing failed), 500 otherwise; a guard's refusal already carries its status. */
export function githubFailureResponse(
  err: unknown,
  h: ResponseToolkit,
  resource: string,
): ResponseObject {
  rethrowBoom(err);
  enforceTrue(
    httpStatusOf(err) !== 404,
    apiError(404),
    `${resource} not found`,
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
