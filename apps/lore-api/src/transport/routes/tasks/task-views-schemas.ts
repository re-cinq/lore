import { z } from "zod";
import { pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import {
  TaskEventSchema,
  TASK_EVENT_COLUMNS,
} from "@re-cinq/lore-shared/models/task-event.js";
import {
  LlmCallSchema,
  LLM_CALL_COLUMNS,
} from "@re-cinq/lore-shared/models/llm-call.js";
import {
  AuditLogEntrySchema,
  AUDIT_LOG_ENTRY_COLUMNS,
} from "@re-cinq/lore-shared/models/audit-log-entry.js";
import { clampedLimit } from "../common-schemas.js";

// Request + response shapes for the task-shaped dashboard reads (ADR-032).

export const RepoTasksQuery = z.object({
  repo: z.string().min(1).max(200),
  limit: clampedLimit.default(15),
});

export type RepoTasksQuery = z.infer<typeof RepoTasksQuery>;

export const AgentActivityQuery = z.object({
  repo: z.string().max(200).optional(),
});

export type AgentActivityQuery = z.infer<typeof AgentActivityQuery>;

export const AuditLogQuery = z.object({
  repo: z.string().min(1).max(200),
  /** Comma-separated: the caller names the decision types its panel renders. */
  event_types: z.string().min(1).max(500),
  limit: clampedLimit.default(25),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

// Task dashboard's read models: stored fields come from the models, computed aggregates (counts, cost, roll-up) belong to no table and are stated here.
const REPO_TASK_FIELDS = [
  "id",
  "description",
  "taskType",
  "status",
  "agentId",
  "prUrl",
  "createdAt",
] as const;

export const REPO_TASK_COLUMNS = pickColumns(
  PIPELINE_TASK_COLUMNS,
  REPO_TASK_FIELDS,
);

export const RepoTaskListSchema = z.object({
  tasks: z.array(
    wireSchema(
      PipelineTaskSchema.pick({
        id: true,
        description: true,
        taskType: true,
        status: true,
        agentId: true,
        prUrl: true,
        createdAt: true,
      }),
      REPO_TASK_COLUMNS,
    ),
  ),
});

export const TaskStatsSchema = z.object({
  total: z.number(),
  today: z.number(),
});

/** One row per agent, unioned across tasks and memories. */
export const AgentActivitySchema = z.object({
  agents: z.array(
    z.object({
      agent_id: z.string().nullable(),
      task_count: z.number(),
      cost_usd: z.number(),
      created_by: z.string().nullable(),
      reason_type: z.string().nullable(),
      reason: z.string().nullable(),
      memory_count: z.number(),
      last_active: z.string().nullable(),
    }),
  ),
});

const TASK_RUNTIME_LLM_FIELDS = [
  "model",
  "inputTokens",
  "outputTokens",
  "durationMs",
  "status",
  "error",
  "createdAt",
] as const;

export const TASK_RUNTIME_LLM_COLUMNS = pickColumns(
  LLM_CALL_COLUMNS,
  TASK_RUNTIME_LLM_FIELDS,
);

export const TaskRuntimeSchema = z.object({
  events: z.array(wireSchema(TaskEventSchema, TASK_EVENT_COLUMNS)),
  llm_calls: z.array(
    wireSchema(
      LlmCallSchema.pick({
        model: true,
        inputTokens: true,
        outputTokens: true,
        durationMs: true,
        status: true,
        error: true,
        createdAt: true,
      }),
      LLM_CALL_COLUMNS,
    ),
  ),
});

export const AuditLogPageSchema = z.object({
  entries: z.array(
    wireSchema(
      AuditLogEntrySchema.pick({
        eventType: true,
        payload: true,
        createdAt: true,
      }),
      AUDIT_LOG_ENTRY_COLUMNS,
    ),
  ),
});
