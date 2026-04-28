import { query } from "../db.js";
import { requiresApproval } from "../approval.js";

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

  if (overrides?.with_issue === true) {
    return { create: true, reason: "with_issue_override" };
  }

  // Approval-required tasks always get an Issue (the Issue is the gate
  // surface). This wins even over `with_issue: false`.
  if (approvalNeeded) {
    return {
      create: true,
      reason: "approval_required_overrides_dark_mode",
    };
  }

  let settings: DarkFactoryRepoSettings | undefined;
  try {
    const rows = await query<{ settings: { dark_factory?: DarkFactoryRepoSettings } }>(
      `SELECT settings FROM lore.repos WHERE full_name = $1`,
      [targetRepo],
    );
    settings = rows[0]?.settings?.dark_factory;
  } catch (err) {
    // DB read failures degrade to default behavior — preserve opt-out.
    console.warn(
      `[dark-factory] settings read failed for ${targetRepo}:`,
      (err as Error).message,
    );
    return { create: true, reason: "default_create" };
  }

  if (!settings?.enabled) {
    return { create: true, reason: "default_create" };
  }

  const policy = settings.create_issue ?? "on_gate";
  switch (policy) {
    case "never":
      return { create: false, reason: "create_issue_never" };
    case "always":
      return { create: true, reason: "create_issue_always" };
    case "on_gate":
      // approvalNeeded was already short-circuited above; reaching
      // here means no approval gate, so suppress the Issue.
      return {
        create: false,
        reason: "create_issue_on_gate_no_approval",
      };
  }
}
