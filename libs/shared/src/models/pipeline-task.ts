import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.tasks` — one unit of pipeline work; late-added columns need migration `0043_tasks_late_columns.sql` on a database bootstrapped before them, else `selectList` here 42703s (Floor crash-loop, 2026-08-20). Task id is stable across retries — per-attempt identity is the AssemblyRun's (ADR-024). */

export const TaskStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "running-local",
  "pr-created",
  "review",
  "completed",
  "merged",
  "failed",
  "cancelled",
  "retried",
  "needs-human-help",
  "awaiting_approval",
]);

export const TaskTypeSchema = z.enum([
  "general",
  "implementation",
  "runbook",
  "gap-fill",
  "review",
  "feature-request",
  "onboard",
  "spec-task",
]);

export const PipelineTaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  taskType: z.string(),
  status: z.string(),
  targetRepo: z.string(),
  targetBranch: z.string().nullable(),
  agentId: z.string().nullable(),
  prUrl: z.string().nullable(),
  prNumber: z.number().nullable(),
  reviewIteration: z.number(),
  contextBundle: z.record(z.unknown()).nullable(),
  contextRefs: z.record(z.unknown()).nullable(),
  darkFactoryOverrides: z.record(z.unknown()).nullable(),
  failureReason: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  priority: z.string(),
  logUrl: z.string().nullable(),
  claimedBy: z.string().nullable(),
  claimedAt: z.date().nullable(),
  taskGroupId: z.string().nullable(),
  actor: z.string().nullable(),
  issueNumber: z.number().nullable(),
  issueUrl: z.string().nullable(),
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskType = z.infer<typeof TaskTypeSchema>;
export type PipelineTask = z.infer<typeof PipelineTaskSchema>;

export const PIPELINE_TASK_COLUMNS = {
  id: "id",
  description: "description",
  taskType: "task_type",
  status: "status",
  targetRepo: "target_repo",
  targetBranch: "target_branch",
  agentId: "agent_id",
  prUrl: "pr_url",
  prNumber: "pr_number",
  reviewIteration: "review_iteration",
  contextBundle: "context_bundle",
  contextRefs: "context_refs",
  darkFactoryOverrides: "dark_factory_overrides",
  failureReason: "failure_reason",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
  priority: "priority",
  logUrl: "log_url",
  claimedBy: "claimed_by",
  claimedAt: "claimed_at",
  taskGroupId: "task_group_id",
  actor: "actor",
  issueNumber: "issue_number",
  issueUrl: "issue_url",
} as const satisfies ColumnMap<PipelineTask>;

export const PIPELINE_TASK_TABLE = "pipeline.tasks";
