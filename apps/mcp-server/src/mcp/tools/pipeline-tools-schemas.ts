import { z } from "zod";

// Tool input schemas live as data beside their tool: a zod object is a contract, not a step in registering one.
export const CREATE_PIPELINE_TASK_INPUT = {
  description: z
    .string()
    .min(1)
    .max(10000)
    .refine((v) => v.trim().length > 0, {
      message: "description cannot be blank",
    })
    .describe(
      "Primary natural-language instruction; be specific. Max 10000 chars; non-empty.",
    ),
  task_type: z
    .string()
    .default("general")
    .describe(
      "feature-request | general | runbook | implementation | gap-fill | review. Unknown values fall back to 'general'. 'onboard' is refused here — use lore_onboard_repo, which guards against duplicate onboarding.",
    ),
  target_repo: z
    .string()
    .optional()
    .describe("'owner/repo'. Auto-detected from git remote when omitted."),
  priority: z
    .enum(["normal", "immediate"])
    .default("normal")
    .describe(
      "'normal' = backlog; 'immediate' = GKE agent auto-executes within ~30s.",
    ),
  group_id: z
    .string()
    .optional()
    .describe(
      "Task-group UUID to link this task into a multi-repo feature rollup (see lore_list_task_group).",
    ),
  context: z
    .object({
      spec_file: z.boolean().optional(),
      branch: z.string().optional(),
      seed_query: z.string().optional(),
    })
    .optional()
    .describe("Optional context for the agent: spec_file, branch, seed_query."),
};

export const GET_PR_STATUS_INPUT = {
  repo: z.string().describe("'owner/repo'"),
  pr_number: z
    .number()
    .describe("PR number (integer from the PR URL, not a UUID)."),
};

export const LIST_PIPELINE_TASKS_INPUT = {
  status: z
    .string()
    .optional()
    .describe(
      "Filter by status: pending | queued | running | pr-created | review | merged | failed | cancelled. Omit for all.",
    ),
  limit: z.number().default(20),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Skip this many newest-first rows for paging. Response carries total so you know if more remain.",
    ),
};

export const LIST_TASK_GROUP_INPUT = {
  group_id: z
    .string()
    .describe(
      "Task-group UUID (the value passed as group_id to lore_create_pipeline_task).",
    ),
};

export const SYNC_TASKS_INPUT = {
  tasks_markdown: z
    .string()
    .describe(
      "Full markdown text of the tasks.md document (not a path). Parsed for phases, [P] parallel markers, [DEPENDS ON: …] deps, and file-path suffixes.",
    ),
  repo: z
    .string()
    .optional()
    .describe("'owner/repo'. Auto-detected from git remote when omitted."),
  spec_slug: z
    .string()
    .describe("Feature slug grouping these spec-tasks within the repo."),
};

export const READY_TASKS_INPUT = {
  repo: z
    .string()
    .optional()
    .describe("'owner/repo'. Auto-detected from git remote when omitted."),
};

export const CLAIM_TASK_INPUT = {
  task_id: z.string(),
  agent_id: z
    .string()
    .optional()
    .describe("Claiming agent identifier. Auto-resolved when omitted."),
};

export const GET_TASK_LOGS_INPUT = {
  task_id: z.string(),
  offset: z
    .number()
    .default(0)
    .describe(
      "UTF-16 code-unit offset (not bytes) into the flattened transcript; pass previous next_offset to poll incrementally.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque resume cursor from the previous response; pass it back only together with that response's next_offset as offset. Omit it when reading from any other offset.",
    ),
};

export const GET_JOB_LOGS_INPUT = {
  job_name: z
    .string()
    .describe(
      "Scheduled job name, e.g. 'context_reindex' or 'spec_test_linker'.",
    ),
  run_id: z.string().describe("Run UUID from pipeline.job_runs."),
};

export const LIST_PENDING_TASKS_INPUT = {
  repo: z
    .string()
    .optional()
    .describe("'owner/repo' filter for the API view. Omit for all repos."),
};

export const ENABLE_TASK_NOTIFICATIONS_INPUT = {
  repos: z
    .array(z.string())
    .optional()
    .describe(
      "Repos to watch as 'owner/repo'. Defaults to current git remote.",
    ),
  task_types: z
    .array(z.string())
    .optional()
    .describe(
      "Task types to surface. Defaults to implementation, general, runbook, gap-fill.",
    ),
};
