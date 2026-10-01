import { z } from "zod";
import {
  detectCurrentBranch,
  detectCurrentRepo,
} from "@re-cinq/lore-server-core/features/repo/repo-detect.js";

export type ServerMode = "full" | "agent";

export const NO_REPO_GIVEN =
  "No repo given. Pass repo as owner/name (e.g. 're-cinq/lore'): the shared Lore server has no checkout to detect it from.";

export function resolveRepo(
  explicit: string | undefined,
  mode: ServerMode,
): string | null {
  if (explicit) {
    return explicit;
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
