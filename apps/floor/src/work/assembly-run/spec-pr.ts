/** Module: open and record the PR a push node produced (load-bearing for the merged node's resumability). */

import { prFooter } from "@re-cinq/lore-shared";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

/** Constant prompt_ref for every line's pushing node; by recipe not id keeps it resilient to renames. */
const PUSH_PROMPT_REF = "push-only";

/** The line whose pull request IS the repo's onboarding PR. */
const ONBOARD_BLUEPRINT = "onboard";

/** Decide if PR open failure is empty-branch (node pushed nothing, #1330) or transient (retry candidate). */
export function decideStampFailure(
  message: string,
): "empty-branch" | "transient" {
  return /no commits between/i.test(message) ? "empty-branch" : "transient";
}

/** Reason for empty branch failure; names the node that should have delivered commits. */
export function emptyBranchReason(branch: string | null): string {
  return `the push node reported success but pushed nothing — ${branch ?? "the run branch"} has no commits, so no spec PR could be opened`;
}

/** How a line whose push delivered nothing ends. For every line that is an error — a wait node would park forever on a PR that cannot exist (#1330) — except onboarding, where "the Floor had nothing to refresh and the agent nothing to add" is the answer to a hand-triggered update of a setup that is already current. */
export function decideEmptyBranchEnding(
  row: Pick<AssemblyRunRecord, "blueprintName" | "branch">,
): { outcome: "completed" | "error"; reason: string } {
  return row.blueprintName === ONBOARD_BLUEPRINT
    ? {
        outcome: "completed",
        reason:
          "the Lore setup is already current — nothing to change, so no pull request was opened",
      }
    : { outcome: "error", reason: emptyBranchReason(row.branch) };
}

/** Decide if finished node should stamp PR on line; idempotent for push re-runs after corrections. */
export function decidePrStamp(input: {
  promptRef?: string | null;
  outcome: string | null;
  args: Record<string, unknown>;
}): boolean {
  return (
    input.promptRef === PUSH_PROMPT_REF &&
    input.outcome === "success" &&
    !input.args.pr_number
  );
}

/** Decide if PR opens as draft (read from run args); drafts bypass code review for multiple pushes. */
export function decidePrDraft(args: Record<string, unknown>): boolean {
  return args.pr_draft === true;
}

/** Decide if ready node hands PR to human (once per run, keyed on destination node type not id, FR6.32). */
export function decideMarkReady(input: {
  outcome: string | null;
  nextNodeType: string | undefined;
  args: Record<string, unknown>;
}): boolean {
  return (
    input.outcome === "success" &&
    input.nextNodeType === "pr_review" &&
    typeof input.args.pr_number === "number" &&
    input.args.pr_ready_flipped !== true
  );
}

/** Maximum PR title length (70 chars); unread titles harm discoverability. */
const TITLE_MAX = 70;

/** Draft PR title from the plan or issue title; branch name as fallback if there is neither. */
export function draftPrTitle(input: {
  args: Record<string, unknown>;
  branch: string;
}): string {
  const plan = planTitleArg(input.args);

  if (plan) {
    return `spec: ${plan}`;
  }
  const ticket = input.args.issue_title;

  if (typeof ticket === "string" && ticket.trim().length > 0) {
    return clampTitle(ticket);
  }

  return `lore: ${input.branch}`;
}

/** Title the ready flip renames PR to (from pr-ready node); null keeps draft title. */
export function readyPrTitle(
  extras: Record<string, string> | undefined,
): string | null {
  const reported = extras?.["Lore-Pr-Title"];

  if (typeof reported !== "string" || reported.trim().length === 0) {
    return null;
  }

  return clampTitle(reported);
}

/** One line, no runs of whitespace, cut with an ellipsis past the cap. */
function clampTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();

  return oneLine.length > TITLE_MAX
    ? `${oneLine.slice(0, TITLE_MAX - 1)}…`
    : oneLine;
}

/** Narrow repo-bound slice of project; caller passes pulls directly. */
export interface SpecPrPorts {
  pulls: {
    list(): Promise<PullRef[]>;
    open(
      branch: string,
      pr: {
        title: string;
        body: string;
        base?: string;
        labels?: string[];
        draft?: boolean;
      },
    ): Promise<PullRef>;
  };
  assemblyRuns: {
    mergeArgs(id: string, patch: Record<string, unknown>): Promise<void>;
  };
  /** Where an ONBOARDING's PR is recorded: the repo row the onboard guard and the merge-check sweep read. Optional because most callers stamp no onboarding. */
  onboarding?: {
    setOnboardingPrUrl(repo: string, url: string): Promise<void>;
  };
}

/** Whether this line's PR must be recorded as the repo's onboarding PR — the guard blocks a second onboarding on it, and the merge-check sweep flips `onboarding_pr_merged` from it. */
export function decideOnboardingPrRecord(
  row: Pick<AssemblyRunRecord, "blueprintName">,
): boolean {
  return row.blueprintName === ONBOARD_BLUEPRINT;
}

/** Ensure a PR on the branch and record it on the line. */
export async function stampLinePr(
  row: AssemblyRunRecord,
  ports: SpecPrPorts,
): Promise<void> {
  const branch = row.branch;

  if (!branch) {
    return;
  }
  const title = draftPrTitle({ args: row.args, branch });
  const pr = await ensurePr({ branch, ports, title, row });

  await recordOpenedPr(row, pr, ports);
}

interface EnsurePrInput {
  branch: string;
  ports: SpecPrPorts;
  title: string;
  row: AssemblyRunRecord;
}

async function ensurePr(input: EnsurePrInput): Promise<PullRef> {
  const { branch, ports, title, row } = input;

  return (
    (await existingPrFor(branch, ports.pulls)) ??
    (await ports.pulls.open(branch, {
      title,
      body: prBody(branch, row),
      draft: decidePrDraft(row.args),
    }))
  );
}

/** Find existing PR on branch to avoid forking review across multiple PRs. */
async function existingPrFor(
  branch: string,
  pulls: SpecPrPorts["pulls"],
): Promise<PullRef | null> {
  const open = await pulls.list();

  return open.find((pr) => pr.branch === branch) ?? null;
}

/** Records the opened PR on the line (and, for an onboarding, on the repo). */
async function recordOpenedPr(
  row: AssemblyRunRecord,
  pr: PullRef,
  ports: SpecPrPorts,
): Promise<void> {
  await ports.assemblyRuns.mergeArgs(row.id, {
    pr_number: pr.number,
    pr_url: pr.url,
  });

  if (decideOnboardingPrRecord(row)) {
    await ports.onboarding?.setOnboardingPrUrl(row.repo, pr.url);
  }
}

/** The title of the plan a planning line works from, stamped into its args when the plan's drafting started. */
function planTitleArg(args: Record<string, unknown>): string | null {
  return typeof args.plan_title === "string" && args.plan_title.trim()
    ? args.plan_title
    : null;
}

/** Rewrite PR body with pr-ready prose + footer; coverage verdict downgrades Closes→Refs for partial coverage (#1745). */
export function readyPrBody(
  run: AssemblyRunRecord,
  extras: Record<string, string> | undefined,
): string | null {
  const prose = run.args.pr_description;

  if (typeof prose !== "string" || prose.trim().length === 0) {
    return null;
  }
  const head = prose.trim();

  if (!run.taskId) {
    return head;
  }
  const issueNumber = issueNumberArg(run.args);
  const coverage = coverageFromExtras(extras);

  return head + prFooter({ issueNumber, taskId: run.taskId, coverage });
}

/** Line's PR body with standard footer; adds Lore-Task for PR-to-task resolution and closes merged tickets. */
function prBody(branch: string, run: AssemblyRunRecord): string {
  const plan = planTitleArg(run.args);
  const head = plan
    ? [
        `## ${plan}`,
        "",
        `Planned together in Lore; this PR carries the approved plan's spec from \`${branch}\`.`,
      ].join("\n")
    : `Opened by the Lore assembly line from \`${branch}\`.`;

  const issueNumber = issueNumberArg(run.args);

  return run.taskId
    ? head + prFooter({ issueNumber, taskId: run.taskId })
    : head;
}

function coverageFromExtras(
  extras: Record<string, string> | undefined,
): "partial" | "full" {
  return extras?.["Lore-Issue-Coverage"] === "partial" ? "partial" : "full";
}

function issueNumberArg(args: Record<string, unknown>): number | null {
  return typeof args.issue_number === "number" ? args.issue_number : null;
}
