// The org-wide approval gate's config (lore.settings key `approval_config`), shared by the Floor worker and stations' approval-check so neither holds a disagreeing copy.

import type { PgPool } from "./memory-store.js";

export interface ApprovalConfig {
  required: boolean;
  label: string;
  auto_approve: string[];
  repos: Record<string, { required: boolean }>;
}

let config: ApprovalConfig = {
  required: false,
  label: "approved",
  auto_approve: ["general", "gap-fill"],
  repos: {},
};

/** Loads approval_config from lore.settings, falling back to defaults; takes the pool explicitly since the Floor and stations each load it once at their own boot. */
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
