/**
 * spec-status-upkeep (FR1) — open a one-line PR reconciling a spec's `| Status |`
 * header row with its test-link coverage. Deterministic, no LLM: reads the spec
 * off the repo's default branch, rewrites the single status cell, and opens a
 * `lore-managed` + `spec-status-upkeep` PR for human review. Mirrors the
 * PR-opening plumbing of the spec-coverage-backfill cron (createBranch →
 * commitFile → pulls.open).
 *
 * The target status is derived, never assumed: whatever `spec-status-coverage`
 * says the spec's links entitle it to claim (no links → Draft, some → In Progress,
 * all → Shipped). This is the same function the `lore/require-status-matches-coverage`
 * ESLint rule enforces, so an FR1 PR always lands green — a merged task group no
 * longer implies `Implemented` on its own.
 */

import { randomUUID } from "node:crypto";
import {
  parseDocStatus,
  rewriteSpecStatusRow,
  statusTier,
  type StatusBucket,
} from "./spec-status.js";
import {
  coverageTier,
  expectedStatus,
  statementCoverage,
  statusLabel,
} from "./spec-status-coverage.js";
import type { Project } from "./index.js";

const BRANCH_PREFIX = "lore/spec-status-upkeep";

export interface StatusFlipOptions {
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
   * (`missing`), it has no `| Status |` header row to read (`no-status-row`), its
   * status is terminal and must not be reopened (`terminal` — rejected/retired),
   * it has no testable statement to derive a status from (`no-coverage-tier`), or
   * its status already matches its coverage (`already-current`).
   */
  reason?:
    | "missing"
    | "already-current"
    | "no-status-row"
    | "no-coverage-tier"
    | "terminal";
  /**
   * The bucket the spec claims after this call — the newly written one, or the
   * existing one when skipped. Absent only when no status could be read at all.
   * Callers gate completion state on this rather than on `skipped`: FR1 now
   * legitimately writes `in-progress`, which is not completion.
   */
  status?: StatusBucket;
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
  coverage: string,
  evidence?: string,
): string {
  return [
    `# Mark \`${specPath}\` ${newLabel}`,
    "",
    `${coverage} of \`${specPath}\`'s testable statements carry a \`([validated by](test.ts#Lline))\` link, so this sets its \`| Status |\` header row to **${newLabel}**. Deterministic one-line edit — only the status cell changes.`,
    ...(evidence ? ["", evidence] : []),
    "",
    "_Opened by Lore's `spec-status-upkeep` (FR1): fires when the last spec-task in a feature's task group merges, and sets the status the spec's test links entitle it to claim — the same rule `lore/require-status-matches-coverage` enforces in CI. Review and merge to keep the spec backlog honest._",
  ].join("\n");
}

/**
 * Reconcile `specPath`'s status header with its test-link coverage via a PR.
 * Returns `{ skipped: true }` without opening one when the spec is absent, has no
 * status row, is terminal (rejected/retired), has no testable statement to derive
 * a status from, or already claims the status its coverage supports. Throws on
 * GitHub API errors so the caller can withhold any dependent state change.
 */
export async function openSpecStatusFlipPr(
  project: Project,
  specPath: string,
  opts: StatusFlipOptions = {},
): Promise<StatusFlipResult> {
  const jobLabel = opts.jobLabel ?? "spec-status-upkeep";

  const content = await project.repo.read(specPath);

  if (content === null) {
    return { prUrl: null, skipped: true, reason: "missing" };
  }
  const current = parseDocStatus(content, "spec").status;

  if (current === null) {
    return { prUrl: null, skipped: true, reason: "no-status-row" };
  }

  // A rejected/retired spec is terminal — the same docs the linter skips. Never
  // reopen one off a coverage reading.
  if (statusTier(current) === "skip") {
    return { prUrl: null, skipped: true, reason: "terminal", status: current };
  }
  const { testable, linked } = statementCoverage(content);
  const target = expectedStatus(coverageTier(testable, linked));

  if (target === null) {
    return {
      prUrl: null,
      skipped: true,
      reason: "no-coverage-tier",
      status: current,
    };
  }

  // Comparing buckets (not labels) keeps this idempotent across the corpus's
  // synonyms — an `Implemented` spec at full coverage is already `shipped`.
  if (target === current) {
    return {
      prUrl: null,
      skipped: true,
      reason: "already-current",
      status: current,
    };
  }
  const newLabel = statusLabel(target, "spec");
  // `allowTerminal` is safe here: the terminal statuses are already returned
  // above, and a Shipped→In Progress demotion is exactly this call's job when a
  // statement loses its link.
  const newContent = rewriteSpecStatusRow(content, newLabel, {
    allowTerminal: true,
  });

  if (newContent === null) {
    return {
      prUrl: null,
      skipped: true,
      reason: "no-status-row",
      status: current,
    };
  }

  const branch = buildFlipBranchName(specPath);
  const title = `Mark ${specPath} ${newLabel}`;
  const body = buildFlipPrBody(
    specPath,
    newLabel,
    `${linked} of ${testable}`,
    opts.evidence,
  );

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

  return { prUrl: pr.url, skipped: false, status: target };
}
