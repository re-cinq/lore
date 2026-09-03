// spec-status-upkeep (FR1) — opens a one-line PR reconciling a spec's `| Status |` row with its test-link coverage (Draft/In Progress/Shipped), the same rule `lore/require-status-matches-coverage` enforces in CI.
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
  /** Why nothing was opened: missing spec, no `| Status |` row, terminal status, no testable statement, or already-current. */
  reason?:
    | "missing"
    | "already-current"
    | "no-status-row"
    | "no-coverage-tier"
    | "terminal";
  /** The bucket the spec claims after this call. Callers gate completion on this, not `skipped` — FR1 can legitimately write `in-progress`. */
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

// Reconciles specPath's status header with its coverage via a PR; skips (no PR) when absent/no-status-row/terminal/no-coverage/already-current. Throws on GitHub API errors so the caller can withhold dependent state changes.
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

  // A rejected/retired spec is terminal (same docs the linter skips) — never reopen one off a coverage reading.
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

  // Comparing buckets, not labels, keeps this idempotent across synonyms — an `Implemented` spec at full coverage is already `shipped`.
  if (target === current) {
    return {
      prUrl: null,
      skipped: true,
      reason: "already-current",
      status: current,
    };
  }
  const newLabel = statusLabel(target, "spec");
  // `allowTerminal` is safe: terminal statuses already returned above, and a Shipped→In Progress demotion is exactly this call's job.
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
  const pr = await project.pulls.open(branch, {
    title,
    body,
    labels: ["lore-managed", jobLabel],
  });

  return { prUrl: pr.url, skipped: false, status: target };
}
