import { settings as settingsRepo } from "../../kernel/queues.js";
import { requiresApproval } from "@re-cinq/lore-shared";
// Canonical types + resolver moved to @re-cinq/lore-shared so all
// consumers (agent, mcp-server, GKE Job pod runner) share one source.
import {
  resolveDarkFactorySettings,
  trustMeets,
  type DarkFactorySettings,
  type ResolvedDarkFactorySettings,
  type ReviewMode,
} from "@re-cinq/lore-shared";

// Re-export so existing agent callers don't need to switch imports.
export {
  resolveDarkFactorySettings,
  trustMeets,
  type ResolvedDarkFactorySettings,
  type ReviewMode,
};

/**
 * Per-repo dark-factory configuration as stored under
 * `lore.repos.settings.dark_factory`. Alias of the canonical type.
 */
export type DarkFactoryRepoSettings = DarkFactorySettings;

export interface DarkFactoryTaskOverrides {
  human_review?: "required";
  with_issue?: boolean;
  notify_on_completion?: boolean;
}

export interface IssueGateDecision {
  create: boolean;
  reason:
    | "default_create"
    | "create_issue_never"
    | "create_issue_always"
    | "create_issue_on_gate_no_approval"
    | "create_issue_on_gate_approval_required"
    | "with_issue_override"
    | "approval_required_overrides_dark_mode";
}

/**
 * Pure decision: given the task's approval flag, per-task overrides,
 * and the repo's dark_factory settings, decide whether a GitHub Issue
 * should be created. Exported separately from
 * {@link shouldCreateIssue} so callers can unit-test without the DB
 * round-trip.
 */
export function decideIssueCreate(args: {
  approvalNeeded: boolean;
  overrides: DarkFactoryTaskOverrides | undefined;
  settings: DarkFactoryRepoSettings | undefined;
}): IssueGateDecision {
  if (args.overrides?.with_issue === true) {
    return { create: true, reason: "with_issue_override" };
  }

  // Approval-required tasks always get an Issue (the Issue is the gate
  // surface). This wins even over `with_issue: false`.
  if (args.approvalNeeded) {
    return {
      create: true,
      reason: "approval_required_overrides_dark_mode",
    };
  }

  if (!args.settings?.enabled) {
    return { create: true, reason: "default_create" };
  }

  const policy = args.settings.create_issue ?? "on_gate";

  switch (policy) {
    case "never":
      return { create: false, reason: "create_issue_never" };
    case "always":
      return { create: true, reason: "create_issue_always" };
    case "on_gate":
      // approvalNeeded was short-circuited above; reaching here means
      // no approval gate, so suppress the Issue.
      return { create: false, reason: "create_issue_on_gate_no_approval" };
  }
}

/**
 * Pure decision (T034): resolves the effective review mode for a
 * task by merging per-task overrides over per-repo dark_factory
 * settings.
 *
 * - per-task `human_review: required` → `always` (cannot be weakened).
 * - dark_factory disabled → `always` (legacy / opt-out behavior).
 * - dark_factory enabled → `settings.review` (default `trust_based`).
 *
 * `trust_based` is the dark-mode default that lets the auto-merge
 * engine gate per-path; `always` forces every PR to wait for a human;
 * `never` skips the bot review entirely.
 */
export function decideReviewMode(args: {
  overrides: DarkFactoryTaskOverrides | undefined;
  settings: DarkFactoryRepoSettings | undefined;
}): ReviewMode {
  if (args.overrides?.human_review === "required") {
    return "always";
  }

  if (!args.settings?.enabled) {
    return "always";
  }

  return args.settings.review ?? "trust_based";
}

/**
 * Decide whether to create a GitHub Issue for a task. Defaults to
 * creating (preserves opt-out behavior). When `dark_factory.enabled`
 * is true, applies the `create_issue` policy. Per-task
 * `with_issue: true` always forces creation; per-task
 * `with_issue: false` is honored only when the task does not require
 * approval (per data-model.md, the latter cannot be silently
 * weakened).
 */
export async function shouldCreateIssue(task: {
  id: string;
  task_type: string;
  target_repo: string | null;
  dark_factory_overrides?: DarkFactoryTaskOverrides | null;
}): Promise<IssueGateDecision> {
  const overrides = task.dark_factory_overrides ?? undefined;
  const targetRepo = task.target_repo;

  if (!targetRepo) {
    return { create: true, reason: "default_create" };
  }

  const approvalNeeded = requiresApproval(task.task_type, targetRepo);
  const settings = await loadRepoSettings(targetRepo);

  return decideIssueCreate({ approvalNeeded, overrides, settings });
}

async function loadRepoSettings(
  targetRepo: string,
): Promise<DarkFactoryRepoSettings | undefined> {
  try {
    const raw = await settingsRepo().rawSettings(targetRepo);

    return (raw as { dark_factory?: DarkFactoryRepoSettings } | null)
      ?.dark_factory;
  } catch (err) {
    console.warn(
      `[dark-factory] settings read failed for ${targetRepo}:`,
      (err as Error).message,
    );

    return undefined;
  }
}
