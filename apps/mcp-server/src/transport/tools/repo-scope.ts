import { z } from "zod";
import { textResult } from "./deps.js";
import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";

export type ServerMode = "full" | "agent";

export const NO_REPO_GIVEN =
  "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.";

export const NO_REPO_DETECTED =
  "Could not detect repo. Specify repo parameter (e.g., 're-cinq/my-service').";

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

/** The tool error for a repo that is not an owner/name, or null when none was given or it is well formed. Checked before any API path is built from it. */
export function invalidRepoRefusal(
  explicit: string | undefined,
): string | null {
  if (!explicit || isRepoName(explicit)) {
    return null;
  }

  return `Invalid repo '${explicit}'. Pass repo as owner/name (e.g. 're-cinq/lore').`;
}

function isRepoName(repo: string): boolean {
  return REPO_PATTERN.test(repo) && !repo.includes("..");
}

export function resolveRepo(
  explicit: string | undefined,
  mode: ServerMode,
): string | null {
  if (explicit) {
    return isRepoName(explicit) ? explicit : null;
  }

  return mode === "agent" ? null : detectCurrentRepo();
}

export function resolveBranch(
  explicit: string | undefined,
  mode: ServerMode,
): string | null {
  if (explicit) {
    return explicit;
  }

  return mode === "agent" ? null : detectCurrentBranch();
}

export function repoParam(mode: ServerMode) {
  return z
    .string()
    .optional()
    .describe(
      mode === "agent"
        ? "'owner/repo'. Required: this server has no checkout to detect it from."
        : "'owner/repo'. Auto-detected from the git remote when omitted.",
    );
}

export async function withRepo<A extends { repo?: string }, R>(
  args: A,
  mode: ServerMode,
  read: (args: A & { repo: string }) => Promise<R>,
): Promise<R | ReturnType<typeof textResult>> {
  const refusal = invalidRepoRefusal(args.repo);

  if (refusal) {
    return textResult(refusal);
  }
  const repo = resolveRepo(args.repo, mode);

  if (!repo) {
    return textResult(mode === "agent" ? NO_REPO_GIVEN : NO_REPO_DETECTED);
  }

  return read({ ...args, repo });
}
