/**
 * spec-status-upkeep (FR1) — open a one-line PR flipping a spec's `| Status |`
 * header row to `Implemented`. Deterministic, no LLM: reads the spec off the
 * repo's default branch, rewrites the single status cell, and opens a
 * `lore-managed` + `spec-status-upkeep` PR for human review. Mirrors the
 * PR-opening plumbing of the spec-coverage-backfill cron (createBranch →
 * commitFile → pulls.open).
 */

import { randomUUID } from "node:crypto";
import { rewriteSpecStatusRow, parseDocStatus } from "./spec-status.js";
import type { Project } from "./index.js";

const BRANCH_PREFIX = "lore/spec-status-upkeep";

export interface StatusFlipOptions {
  /** Value written into the Status cell. Default `"Implemented"`. */
  newLabel?: string;
  /** One line of completion evidence appended to the PR body. */
  evidence?: string;
  /** PR label identifying the opener. Default `"spec-status-upkeep"`. */
  jobLabel?: string;
}

export interface StatusFlipResult {
  /** The opened PR's URL, or null when nothing was opened. */
  prUrl: string | null;
  /** True when no PR was opened. */
  skipped: boolean;
  /**
   * Why nothing was opened: the spec is absent on the default branch
   * (`missing`), its status already buckets to shipped (`already-current`), or
   * it has no `| Status |` header row to flip (`no-status-row`).
   */
  reason?: "missing" | "already-current" | "no-status-row";
}

function buildFlipBranchName(specPath: string): string {
  const safe = specPath
    .replace(/^specs\//, "")
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9._/-]/g, "-")
    .replace(/\/+/g, "-")
    .slice(0, 60);
  // Random suffix (not wall-clock) so two flips for the same spec never collide.
  const token = randomUUID().slice(0, 8);

  return `${BRANCH_PREFIX}/${safe}-${token}`;
}

function buildFlipPrBody(
  specPath: string,
  newLabel: string,
  evidence?: string,
): string {
  return [
    `# Mark \`${specPath}\` ${newLabel}`,
    "",
    `The feature described in \`${specPath}\` is complete, so this flips its \`| Status |\` header row to **${newLabel}**. Deterministic one-line edit — only the status cell changes.`,
    ...(evidence ? ["", evidence] : []),
    "",
    "_Opened by Lore's `spec-status-upkeep` (FR1): fires when the last spec-task in a feature's task group merges. Review and merge to keep the spec backlog honest._",
  ].join("\n");
}

/**
 * Flip `specPath`'s status header to `Implemented` (or `opts.newLabel`) via a PR.
 * Returns `{ skipped: true }` without opening a PR when the spec is absent on the
 * default branch or its status already buckets to shipped/implemented. Throws on
 * GitHub API errors so the caller can withhold any dependent state change.
 */
export async function openSpecStatusFlipPr(
  project: Project,
  specPath: string,
  opts: StatusFlipOptions = {},
): Promise<StatusFlipResult> {
  const newLabel = opts.newLabel ?? "Implemented";
  const jobLabel = opts.jobLabel ?? "spec-status-upkeep";

  const content = await project.repo.read(specPath);

  if (content === null) {
    return { prUrl: null, skipped: true, reason: "missing" };
  }

  const newContent = rewriteSpecStatusRow(content, newLabel);

  if (newContent === null) {
    const hasStatusRow = parseDocStatus(content, "spec").status !== null;

    return {
      prUrl: null,
      skipped: true,
      reason: hasStatusRow ? "already-current" : "no-status-row",
    };
  }

  const branch = buildFlipBranchName(specPath);
  const title = `Mark ${specPath} ${newLabel}`;
  const body = buildFlipPrBody(specPath, newLabel, opts.evidence);

  await project.repo.createBranch(branch);
  await project.repo.commitFile(
    branch,
    specPath,
    newContent,
    `lore: mark ${specPath} ${newLabel}`,
  );
  const pr = await project.pulls.open(branch, title, body, undefined, [
    "lore-managed",
    jobLabel,
  ]);

  return { prUrl: pr.url, skipped: false };
}
