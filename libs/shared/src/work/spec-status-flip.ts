// spec-status-upkeep (FR1) — opens a one-line PR reconciling a spec's `| Status |` row with its test-link coverage (Draft/In Progress/Shipped), the same rule `lore/require-status-matches-coverage` enforces in CI.
import { randomUUID } from "node:crypto";
import {
  parseDocStatus,
  rewriteSpecStatusRow,
  statusTier,
  type StatusBucket,
} from "../domain/spec-status.js";
import {
  coverageTier,
  expectedStatus,
  statementCoverage,
  statusLabel,
} from "./spec-status-coverage.js";
import type { Project } from "../outbound/project/lib/project.js";

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

type FlipCommit = Extract<FlipDecision, { outcome: "flip" }>;

interface FlipPrMeta {
  evidence?: string;
  jobLabel: string;
}

// Reconciles specPath's status header with its coverage via a PR; skips (no PR) when absent/no-status-row/terminal/no-coverage/already-current.
export async function openSpecStatusFlipPr(
  project: Project,
  specPath: string,
  opts: StatusFlipOptions = {},
): Promise<StatusFlipResult> {
  const jobLabel = opts.jobLabel ?? "spec-status-upkeep";
  const { repo } = project;
  const content = await repo.read(specPath);

  if (content === null) {
    return { prUrl: null, skipped: true, reason: "missing" };
  }

  const decision = decideStatusFlip(content);

  if (decision.outcome === "skip") {
    return skippedFlip(decision);
  }

  return openFlipPr(project, specPath, decision, {
    evidence: opts.evidence,
    jobLabel,
  });
}

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

  return decideFromCoverage(content, current, statementCoverage(content));
}

// The decision once the spec is known to carry a non-terminal status row: compares the coverage-entitled bucket against the claimed one and rewrites when they differ.
function decideFromCoverage(
  content: string,
  current: StatusBucket,
  coverage: { testable: number; linked: number },
): FlipDecision {
  const { testable, linked } = coverage;
  const target = expectedStatus(coverageTier(testable, linked));

  if (target === null) {
    return { outcome: "skip", reason: "no-coverage-tier", status: current };
  }

  // Comparing buckets, not labels, keeps this idempotent across synonyms — an `Implemented` spec at full coverage is already `shipped`.
  if (target === current) {
    return { outcome: "skip", reason: "already-current", status: current };
  }
  const rewritten = rewriteTo(content, target);

  if (rewritten === null) {
    return { outcome: "skip", reason: "no-status-row", status: current };
  }

  return { outcome: "flip", status: target, ...rewritten, linked, testable };
}

/** The spec's content with its status row set to `target`, or null when the row has gone missing between the two reads. `allowTerminal` is safe here: terminal statuses returned before this call, and a Shipped→In Progress demotion is exactly this function's job. */
function rewriteTo(
  content: string,
  target: NonNullable<ReturnType<typeof expectedStatus>>,
): { newLabel: string; newContent: string } | null {
  const newLabel = statusLabel(target, "spec");
  const newContent = rewriteSpecStatusRow(content, newLabel, {
    allowTerminal: true,
  });

  return newContent === null ? null : { newLabel, newContent };
}

// The no-PR result carrying a "skip" decision's reason and the status the spec keeps claiming.
function skippedFlip(
  decision: Extract<FlipDecision, { outcome: "skip" }>,
): StatusFlipResult {
  return {
    prUrl: null,
    skipped: true,
    reason: decision.reason,
    status: decision.status,
  };
}

// Opens the flip PR for a `decideStatusFlip` "flip" decision; throws on GitHub API errors so the caller can withhold dependent state changes.
async function openFlipPr(
  project: Project,
  specPath: string,
  decision: FlipCommit,
  meta: FlipPrMeta,
): Promise<StatusFlipResult> {
  const branch = await commitStatusFlip(project, specPath, decision);
  const { pulls } = project;
  const pr = await pulls.open(branch, {
    title: `Mark ${specPath} ${decision.newLabel}`,
    body: buildFlipPrBody(specPath, decision, meta.evidence),
    labels: ["lore-managed", meta.jobLabel],
  });

  return { prUrl: pr.url, skipped: false, status: decision.status };
}

// Creates the flip branch and commits the rewritten spec onto it, returning the branch name.
async function commitStatusFlip(
  project: Project,
  specPath: string,
  decision: FlipCommit,
): Promise<string> {
  const branch = buildFlipBranchName(specPath);
  const { repo } = project;

  await repo.createBranch(branch);
  await repo.commitFile(
    branch,
    specPath,
    decision.newContent,
    `lore: mark ${specPath} ${decision.newLabel}`,
  );

  return branch;
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
  decision: FlipCommit,
  evidence?: string,
): string {
  const { newLabel } = decision;
  const coverage = `${decision.linked} of ${decision.testable}`;

  return [
    `# Mark \`${specPath}\` ${newLabel}`,
    "",
    `${coverage} of \`${specPath}\`'s testable statements carry a \`([validated by](test.ts#Lline))\` link, so this sets its \`| Status |\` header row to **${newLabel}**. Deterministic one-line edit — only the status cell changes.`,
    ...(evidence ? ["", evidence] : []),
    "",
    "_Opened by Lore's `spec-status-upkeep` (FR1): fires when the last spec-task in a feature's task group merges, and sets the status the spec's test links entitle it to claim — the same rule `lore/require-status-matches-coverage` enforces in CI. Review and merge to keep the spec backlog honest._",
  ].join("\n");
}
