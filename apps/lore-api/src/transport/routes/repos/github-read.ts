import type { ResponseObject, ResponseToolkit } from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { errorMessage, type Project } from "@re-cinq/lore-shared";
import { projectFor } from "../../../outbound/project-boot.js";

// What the repo routes that read GitHub through the App share: the path they name a numbered thing by, the onboarded-repo guard, and how a failed read answers.

export const RepoNumberParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.coerce.number().int().positive(), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

export type RepoNumberParams = z.infer<typeof RepoNumberParams>;

export async function onboardedProject(repo: string): Promise<Project> {
  const project = await projectFor(repo);

  enforceTrue(await project.settings.record(), apiError(404), "repo not found");

  return project;
}

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

export function httpStatusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}
