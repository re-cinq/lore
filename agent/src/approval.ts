import { query } from "./db.js";

export interface ApprovalConfig {
  required: boolean;           // org-level default
  label: string;               // label name to look for (default: "approved")
  auto_approve: string[];      // task types that skip approval
  repos: Record<string, { required: boolean }>; // per-repo overrides
}

let config: ApprovalConfig = {
  required: false,
  label: "approved",
  auto_approve: ["general", "gap-fill"],
  repos: {},
};

/**
 * Load approval config from lore.settings (key: "approval_config").
 * Falls back to defaults if not set.
 */
export async function loadApprovalConfig(): Promise<void> {
  try {
    const rows = await query<{ value: string }>(
      `SELECT value FROM lore.settings WHERE key = 'approval_config'`
    );
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);
      config = { ...config, ...parsed };
    }
  } catch {
    // Use defaults
  }
  console.log(`[agent] Approval config: required=${config.required}, auto_approve=[${config.auto_approve.join(",")}], ${Object.keys(config.repos).length} repo overrides`);
}

/**
 * Check if a task requires approval before processing.
 */
export function requiresApproval(taskType: string, targetRepo: string): boolean {
  // Auto-approve task types skip the gate everywhere
  if (config.auto_approve.includes(taskType)) return false;

  // Per-repo override takes priority
  const repoConfig = config.repos[targetRepo];
  if (repoConfig !== undefined) return repoConfig.required;

  // Fall back to org default
  return config.required;
}

export function getApprovalLabel(): string {
  return config.label;
}

export function getApprovalConfig(): ApprovalConfig {
  return { ...config };
}
