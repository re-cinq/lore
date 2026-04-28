import { query } from "../db.js";
import { requiresApproval } from "../approval.js";

export type ReviewMode = "trust_based" | "always" | "never";

/**
 * Pure resolver: applies dark-factory defaults to a partial settings
 * doc. Mirrors `mcp-server/src/dark-factory-settings.resolveSettings`
 * but lives in the agent so the orchestrator (T058 follow-up) can
 * resolve settings without crossing workspaces.
 */
export interface ResolvedDarkFactorySettings {
  enabled: boolean;
  create_issue: "never" | "on_gate" | "always";
  auto_merge: {
    paths: string[];
    min_trust: "docs" | "tests" | "implementation" | "full";
    require_green_ci: boolean;
    require_bot_approval: boolean;
  };
  review: ReviewMode;
  notify: Array<"escalation" | "watched" | "all">;
}

const DEFAULT_AUTO_MERGE_PATHS = [
  "specs/**",
  "adrs/**",
  "*.md",
  "CLAUDE.md",
  ".claude/**",
];

export function resolveDarkFactorySettings(
  partial: DarkFactoryRepoSettings | null | undefined,
): ResolvedDarkFactorySettings {
  const enabled = partial?.enabled ?? false;
  return {
    enabled,
    create_issue: partial?.create_issue ?? (enabled ? "on_gate" : "always"),
    auto_merge: {
      paths: partial?.auto_merge?.paths ?? DEFAULT_AUTO_MERGE_PATHS,
      min_trust: partial?.auto_merge?.min_trust ?? "docs",
      require_green_ci: partial?.auto_merge?.require_green_ci ?? true,
      require_bot_approval:
        partial?.auto_merge?.require_bot_approval ?? true,
    },
    review: partial?.review ?? (enabled ? "trust_based" : "always"),
    notify: partial?.notify ?? (enabled ? [] : ["all"]),
  };
}

/**
 * Per-repo dark-factory configuration as stored under
 * `lore.repos.settings.dark_factory`. Mirror of the schema in
 * `mcp-server/src/dark-factory-settings.ts` — kept duplicated here so
 * the agent doesn't import from the mcp-server workspace.
 */
export interface DarkFactoryRepoSettings {
  enabled?: boolean;
  create_issue?: "never" | "on_gate" | "always";
  auto_merge?: {
    paths?: string[];
    min_trust?: "docs" | "tests" | "implementation" | "full";
    require_green_ci?: boolean;
    require_bot_approval?: boolean;
  };
  review?: "trust_based" | "always" | "never";
  notify?: Array<"escalation" | "watched" | "all">;
}

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
  if (!targetRepo) return { create: true, reason: "default_create" };

  const approvalNeeded = requiresApproval(task.task_type, targetRepo);
  const settings = await loadRepoSettings(targetRepo);
  return decideIssueCreate({ approvalNeeded, overrides, settings });
}

/**
 * Resolve the effective review mode for a task (T034). Loads repo
 * settings from the DB, merges with per-task overrides via
 * {@link decideReviewMode}.
 */
export async function resolveReviewMode(task: {
  task_type: string;
  target_repo: string | null;
  dark_factory_overrides?: DarkFactoryTaskOverrides | null;
}): Promise<ReviewMode> {
  if (task.dark_factory_overrides?.human_review === "required") {
    return "always";
  }
  const targetRepo = task.target_repo;
  if (!targetRepo) return "always";
  const settings = await loadRepoSettings(targetRepo);
  return decideReviewMode({
    overrides: task.dark_factory_overrides ?? undefined,
    settings,
  });
}

async function loadRepoSettings(
  targetRepo: string,
): Promise<DarkFactoryRepoSettings | undefined> {
  try {
    const rows = await query<{
      settings: { dark_factory?: DarkFactoryRepoSettings };
    }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [targetRepo],
    );
    return rows[0]?.settings?.dark_factory;
  } catch (err) {
    console.warn(
      `[dark-factory] settings read failed for ${targetRepo}:`,
      (err as Error).message,
    );
    return undefined;
  }
}
