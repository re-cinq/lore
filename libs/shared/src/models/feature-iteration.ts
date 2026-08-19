import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `lore.feature_iterations` — one planning round of a feature.
 *
 * DDL: migration `0017_feature_planning.sql`. `taskId` is a SOFT reference to
 * `pipeline.tasks` with no FK, deliberately: a pruned task must not take the
 * planning history with it. `(featureId, iteration)` is unique.
 */

export const FeatureIterationStatusSchema = z.enum([
  "running",
  "ready",
  "failed",
]);

export const FeatureIterationSchema = z.object({
  id: z.string(),
  featureId: z.string(),
  iteration: z.number(),
  taskId: z.string().nullable(),
  status: FeatureIterationStatusSchema,
  userAnswers: z.record(z.unknown()).nullable(),
  gapResult: z.record(z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type FeatureIterationStatus = z.infer<
  typeof FeatureIterationStatusSchema
>;
export type FeatureIteration = z.infer<typeof FeatureIterationSchema>;

export const FEATURE_ITERATION_COLUMNS = {
  id: "id",
  featureId: "feature_id",
  iteration: "iteration",
  taskId: "task_id",
  status: "status",
  userAnswers: "user_answers",
  gapResult: "gap_result",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<FeatureIteration>;

export const FEATURE_ITERATION_TABLE = "lore.feature_iterations";
