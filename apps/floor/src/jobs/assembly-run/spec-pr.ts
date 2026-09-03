/** Module: open and record PR a push node produced (feature-dependent, load-bearing for merged node resumability). */

import { prFooter } from "@re-cinq/lore-shared";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type {
  Feature,
  FeaturePatch,
  FeatureStatus,
} from "@re-cinq/lore-shared/project/features/features-port.js";

/** Constant prompt_ref for every line's pushing node; by recipe not id keeps it resilient to renames. */
const PUSH_PROMPT_REF = "push-only";

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

/** One line, no runs of whitespace, cut with an ellipsis past the cap. */
function clampTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();

  return oneLine.length > TITLE_MAX
    ? `${oneLine.slice(0, TITLE_MAX - 1)}\u2026`
    : oneLine;
}

/** Draft PR title from feature or issue title; branch name as fallback if no ticket. */
export function draftPrTitle(input: {
  featureTitle: string | null;
  args: Record<string, unknown>;
  branch: string;
}): string {
  if (input.featureTitle) {
    return `spec: ${input.featureTitle}`;
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

/** Narrow repo-bound slice of project; caller passes pulls and features directly. */
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
  features: {
    get(id: string): Promise<Feature | null>;
    /** Returns updated row; narrowest honest contract is resolving to something. */
    transitionStatus(
      id: string,
      status: FeatureStatus,
      patch?: FeaturePatch,
    ): Promise<unknown>;
  };
}

/** Find existing PR on branch to avoid forking review across multiple PRs. */
async function existingPrFor(
  branch: string,
  pulls: SpecPrPorts["pulls"],
): Promise<PullRef | null> {
  const open = await pulls.list();

  return open.find((pr) => pr.branch === branch) ?? null;
}

/** Ensure PR on branch, record on line; stamp before feature transition (safer if transition fails). */
export async function stampLinePr(
  row: AssemblyRunRecord,
  ports: SpecPrPorts,
): Promise<void> {
  const branch = row.branch;

  if (!branch) {
    return;
  }
  const featureId =
    typeof row.args.feature_id === "string" ? row.args.feature_id : null;
  const feature = featureId ? await ports.features.get(featureId) : null;
  const title = draftPrTitle({
    featureTitle: feature?.title ?? null,
    args: row.args,
    branch,
  });
  const pr =
    (await existingPrFor(branch, ports.pulls)) ??
    (await ports.pulls.open(branch, {
      title,
      body: prBody(branch, feature, row),
      draft: decidePrDraft(row.args),
    }));

  await ports.assemblyRuns.mergeArgs(row.id, {
    pr_number: pr.number,
    pr_url: pr.url,
  });

  if (!feature) {
    return;
  }

  try {
    await ports.features.transitionStatus(feature.id, "pr-open", {
      spec_pr_url: pr.url,
      spec_pr_number: pr.number,
      spec_path: `specs/${feature.slug}/spec.md`,
    });
  } catch (err) {
    console.warn(
      `[spec-pr] feature ${feature.id} not moved to pr-open: ${(err as Error).message}`,
    );
  }
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
  const issueNumber =
    typeof run.args.issue_number === "number" ? run.args.issue_number : null;
  const coverage =
    extras?.["Lore-Issue-Coverage"] === "partial" ? "partial" : "full";

  return head + prFooter({ issueNumber, taskId: run.taskId, coverage });
}

/** Line's PR body with standard footer; adds Lore-Task for PR-to-task resolution and closes merged tickets. */
function prBody(
  branch: string,
  feature: Feature | null,
  run: AssemblyRunRecord,
): string {
  const head = feature
    ? [
        `## ${feature.title}`,
        "",
        feature.original_prompt,
        "",
        `Planned interactively; this PR carries the agreed spec from \`${branch}\`.`,
      ].join("\n")
    : `Opened by the Lore assembly line from \`${branch}\`.`;

  const issueNumber =
    typeof run.args.issue_number === "number" ? run.args.issue_number : null;

  return run.taskId
    ? head + prFooter({ issueNumber, taskId: run.taskId })
    : head;
}
