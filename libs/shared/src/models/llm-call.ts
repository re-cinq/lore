import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `pipeline.llm_calls` — one LLM invocation's token + cost accounting; `assemblyLineId` deliberately keeps its pre-rename spelling since a pointer column has no compat view under 0040 (0040:130-137) — `stationRunId` is the go-forward correlation key. */

export const LlmCallStatusSchema = z.enum(["success", "failed"]);

export const LlmCallSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  assemblyLineId: z.string().nullable(),
  stationRunId: z.string().nullable(),
  jobName: z.string().nullable(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  durationMs: z.number(),
  status: LlmCallStatusSchema,
  error: z.string().nullable(),
  createdAt: z.date().nullable(),
});

export type LlmCallStatus = z.infer<typeof LlmCallStatusSchema>;
export type LlmCall = z.infer<typeof LlmCallSchema>;

export const LLM_CALL_COLUMNS = {
  id: "id",
  taskId: "task_id",
  assemblyLineId: "assembly_line_id",
  stationRunId: "station_run_id",
  jobName: "job_name",
  model: "model",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  costUsd: "cost_usd",
  durationMs: "duration_ms",
  status: "status",
  error: "error",
  createdAt: "created_at",
} as const satisfies ColumnMap<LlmCall>;

export const LLM_CALL_TABLE = "pipeline.llm_calls";
