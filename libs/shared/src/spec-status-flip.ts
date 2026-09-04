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

type FlipSkipReason = NonNullable<StatusFlipResult["reason"]>;

type FlipDecision =
  | { outcome: "skip"; reason: FlipSkipReason; status?: StatusBucket }
  | {
      outcome: "flip";
      status: StatusBucket;
      newLabel: string;
      newContent: string;
      linked: number;
      testable: number;
    };

// Reconciles specPath's status header with its coverage: skips when no-status-row/terminal/no-coverage/already-current, otherwise the rewritten content to commit.
function decideStatusFlip(content: string): FlipDecision {
  const current = parseDocStatus(content, "spec").status;

  if (current === null) {
    return { outcome: "skip", reason: "no-status-row" };
  }

  // A rejected/retired spec is terminal (same docs the linter skips) — never reopen one off a coverage reading.
  if (statusTier(current) === "skip") {
    return { outcome: "skip", reason: "terminal", status: current };
  }
  const { testable, linked } = statementCoverage(content);
  const target = expectedStatus(coverageTier(testable, linked));

  if (target === null) {
    return { outcome: "skip", reason: "no-coverage-tier", status: current };
  }

  // Comparing buckets, not labels, keeps this idempotent across synonyms — an `Implemented` spec at full coverage is already `shipped`.
  if (target === current) {
    return { outcome: "skip", reason: "already-current", status: current };
  }
  const newLabel = statusLabel(target, "spec");
  // `allowTerminal` is safe: terminal statuses already returned above, and a Shipped→In Progress demotion is exactly this call's job.
  const newContent = rewriteSpecStatusRow(content, newLabel, {
    allowTerminal: true,
  });

  if (newContent === null) {
    return { outcome: "skip", reason: "no-status-row", status: current };
  }

  return {
    outcome: "flip",
    status: target,
    newLabel,
    newContent,
    linked,
    testable,
  };
}

interface FlipPrMeta {
  evidence?: string;
  jobLabel: string;
}

// Opens the flip PR for a `decideStatusFlip` "flip" decision; throws on GitHub API errors so the caller can withhold dependent state changes.
async function openFlipPr(
  project: Project,
  specPath: string,
  decision: Extract<FlipDecision, { outcome: "flip" }>,
  meta: FlipPrMeta,
): Promise<StatusFlipResult> {
  const branch = buildFlipBranchName(specPath);
  const title = `Mark ${specPath} ${decision.newLabel}`;
  const body = buildFlipPrBody(
    specPath,
    decision.newLabel,
    `${decision.linked} of ${decision.testable}`,
    meta.evidence,
  );

  await project.repo.createBranch(branch);
  await project.repo.commitFile(
    branch,
    specPath,
    decision.newContent,
    `lore: mark ${specPath} ${decision.newLabel}`,
  );
  const pr = await project.pulls.open(branch, {
    title,
    body,
    labels: ["lore-managed", meta.jobLabel],
  });

  return { prUrl: pr.url, skipped: false, status: decision.status };
}

// Reconciles specPath's status header with its coverage via a PR; skips (no PR) when absent/no-status-row/terminal/no-coverage/already-current.
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

  const decision = decideStatusFlip(content);

  if (decision.outcome === "skip") {
    return {
      prUrl: null,
      skipped: true,
      reason: decision.reason,
      status: decision.status,
    };
  }

  return openFlipPr(project, specPath, decision, {
    evidence: opts.evidence,
    jobLabel,
  });
}
