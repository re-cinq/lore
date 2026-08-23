// The org-wide approval gate's config (lore.settings key `approval_config`).
//
// Here rather than on the Floor because it has two readers in two processes:
// the Floor worker gates a task on `requiresApproval`, and the stations
// service's approval-check reads `getApprovalLabel` to know which label to look
// for. A copy in each would be a config that disagrees with itself.
//
// Module state, loaded once per process at boot — the same shape it had on the
// Floor, just reachable from both.

import type { PgPool } from "./memory-store.js";

export interface ApprovalConfig {
  required: boolean; // org-level default
  label: string; // label name to look for (default: "approved")
  auto_approve: string[]; // task types that skip approval
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
 *
 * Takes the pool rather than reaching for an ambient one: TWO processes load
 * this now — the Floor, whose worker asks `requiresApproval`, and the stations
 * service, whose approval-check asks `getApprovalLabel`. Each holds its own
 * pool, and each loads this once at its own boot.
 */
export async function loadApprovalConfig(pool: PgPool): Promise<void> {
  try {
    const { rows } = await pool.query<{ value: string }>(
      `SELECT value FROM lore.settings WHERE key = 'approval_config'`,
    );

    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value);

      config = { ...config, ...parsed };
    }
  } catch {
    // Use defaults
  }
  console.log(
    `[approval] config: required=${config.required}, auto_approve=[${config.auto_approve.join(",")}], ${Object.keys(config.repos).length} repo overrides`,
  );
}

/**
 * Check if a task requires approval before processing.
 */
export function requiresApproval(
  taskType: string,
  targetRepo: string,
): boolean {
  // Auto-approve task types skip the gate everywhere
  if (config.auto_approve.includes(taskType)) {
    return false;
  }

  // Per-repo override takes priority
  const repoConfig = config.repos[targetRepo];

  if (repoConfig !== undefined) {
    return repoConfig.required;
  }

  // Fall back to org default
  return config.required;
}

export function getApprovalLabel(): string {
  return config.label;
}

export function getApprovalConfig(): ApprovalConfig {
  return { ...config };
}
