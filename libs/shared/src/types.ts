/** Shared types used across agent, MCP server, and web-ui. */

import type { PIPELINE_TASK_COLUMNS } from "./models/pipeline-task.js";

/** `pipeline.tasks` WIRE shape (snake_case): station pods are a separately deployed image, so both spellings must be accepted for one release before a producer switches (FR6.41); the assertion below fails the build if this drifts from `models/pipeline-task.ts`. */
export interface PipelineTask {
  id: string;
  description: string;
  task_type: string;
  status: string;
  target_repo: string;
  target_branch?: string;
  agent_id?: string;
  pr_url?: string;
  pr_number?: number;
  review_iteration: number;
  context_bundle?: Record<string, unknown>;
  failure_reason?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  log_url?: string;
  claimed_by?: string;
  claimed_at?: string;
  issue_number?: number;
  issue_url?: string;
  actor?: string;
  priority: string;
  task_group_id?: string;
  context_refs?: Record<string, unknown>;
}

/** Every column name the `pipeline.tasks` model binds. */
type TaskColumn =
  (typeof PIPELINE_TASK_COLUMNS)[keyof typeof PIPELINE_TASK_COLUMNS];

type Assert<T extends true> = T;

/** Type-only guard: fails `tsc` if the wire type carries a key that is not a column. */
type WireKeysAreColumns = Assert<
  Exclude<keyof PipelineTask, TaskColumn> extends never ? true : false
>;

export type { WireKeysAreColumns };

export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "running-local"
  | "pr-created"
  | "review"
  | "completed"
  | "merged"
  | "failed"
  | "cancelled"
  | "retried"
  | "needs-human-help"
  | "awaiting_approval";

export type TaskType =
  | "general"
  | "implementation"
  | "runbook"
  | "gap-fill"
  | "review"
  | "feature-request"
  | "onboard"
  | "spec-task";

export interface PRDetails {
  url: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  mergeable: boolean;
  checksStatus: "success" | "failure" | "pending" | "none";
  reviewStatus: "approved" | "changes_requested" | "pending" | "none";
  computedStatus: PRStatus;
}

export type PRStatus =
  | "merged"
  | "closed"
  | "draft"
  | "checks-failing"
  | "changes-requested"
  | "approved"
  | "open";
