/**
 * Response contracts for the feature-planning surface (ADR-035).
 *
 * zod lives HERE, not in libs/shared: shared carries no zod dependency on purpose
 * — `feature-planning/gap-result.ts` hand-rolls its validation so it stays light
 * enough to ride along in the Job pod bundle. Precedent for a schema module in
 * lore-api: `features/agents/agents-schema.ts`.
 *
 * Optional-everything on the gap shapes is intentional: rows stored before the
 * current contract must still deserialize.
 */

import { z } from "zod";

export const FeatureStatusSchema = z.enum([
  "draft",
  "planning",
  "awaiting-input",
  "spec-ready",
  "pr-open",
  "implemented",
]);

export const IterationStatusSchema = z.enum(["running", "ready", "failed"]);

export const FeatureSchema = z.object({
  id: z.string(),
  repo: z.string(),
  title: z.string(),
  slug: z.string(),
  path: z.string(),
  original_prompt: z.string(),
  status: FeatureStatusSchema,
  current_iteration: z.number().int(),
  draft_spec_md: z.string().nullable(),
  parent_feature_id: z.string().nullable(),
  spec_path: z.string().nullable(),
  spec_pr_url: z.string().nullable(),
  spec_pr_number: z.number().int().nullable(),
  issue_number: z.number().int().nullable(),
  issue_url: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const FeatureIterationSchema = z.object({
  id: z.string(),
  feature_id: z.string(),
  iteration: z.number().int(),
  task_id: z.string().nullable(),
  status: IterationStatusSchema,
  user_answers: z.unknown().nullable(),
  gap_result: z.unknown().nullable(),
  parent_iteration: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const FeatureWithIterationsSchema = FeatureSchema.extend({
  iterations: z.array(FeatureIterationSchema),
});

export const FeatureListSchema = z.object({
  features: z.array(FeatureSchema),
});

export const FeatureCreatedSchema = z.object({
  id: z.string(),
  task_id: z.string(),
});

export const OkSchema = z.object({ ok: z.literal(true) });

/** A round that started, however it was dispatched: a fresh Station mints a
 *  `task_id`; a resumed line reports `assembly_line_id` and a null task. */
export const RoundStartedSchema = z.object({
  iteration: z.number().int(),
  task_id: z.string().nullable().optional(),
  assembly_line_id: z.string().optional(),
});

export const FinalizeStartedSchema = z.object({
  task_id: z.string().optional(),
  assembly_line_id: z.string().optional(),
});

export const FeaturePollSchema = z.object({
  feature: FeatureSchema,
  latest_iteration: FeatureIterationSchema.nullable(),
  last_ready_iteration: FeatureIterationSchema.nullable(),
  assembly_line_id: z.string().nullable(),
});

export const FeatureDecompositionSchema = z.object({
  tasks: z.array(
    z.object({
      description: z.string(),
      status: z.string(),
      context_bundle: z.record(z.unknown()).nullable(),
    }),
  ),
});
