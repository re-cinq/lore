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

<<<<<<< HEAD
// The gap-analysis payload a planning round produces, and the author's reply to it.
// Both are stored as jsonb and were typed `unknown` here at first, which generated
// `unknown` for the client — the one field the planning UI spends all its time
// rendering. Everything is optional because a row stored before the current
// contract must still deserialize.
//
// The four LEGACY fields (`architecture`, `user_flows`, top-level `mockups` and
// `questions`) are part of the contract on purpose: the web UI reads gap results
// straight from Postgres on its planning pages, so there is no server hop that
// could normalize them away, and dropping them from the schema would silently lose
// data on rows written before `sections[]` existed.

export const GapMockupSchema = z.object({
  title: z.string().optional(),
  format: z.enum(["svg", "mermaid", "html"]).optional(),
  markup: z.string(),
  section: z.string().optional(),
  /** Pixel height an `html` mockup needs — its frame is sandboxed with no
   *  same-origin access, so it cannot measure itself. */
  height: z.number().optional(),
});

export const GapQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  why: z.string().optional(),
  kind: z.enum(["text", "choice"]).optional(),
  options: z.array(z.string()).optional(),
});

export const GapSectionSchema = z.object({
  title: z.string(),
  content: z.string().optional(),
  mockups: z.array(GapMockupSchema).optional(),
  questions: z.array(GapQuestionSchema).optional(),
});

export const GapResultSchema = z.object({
  sections: z.array(GapSectionSchema).optional(),
  /** CSS lifted from the PLANNED repo, shared by every mockup in this result. */
  mockup_stylesheet: z.string().optional(),
  architecture: z
    .object({
      summary: z.string(),
      components: z.array(
        z.object({
          name: z.string(),
          responsibility: z.string(),
          touchpoints: z.array(z.string()),
        }),
      ),
    })
    .optional(),
  user_flows: z
    .array(z.object({ name: z.string(), steps: z.array(z.string()) }))
    .optional(),
  mockups: z.array(GapMockupSchema).optional(),
  questions: z.array(GapQuestionSchema).optional(),
  split_suggestion: z
    .object({
      rationale: z.string(),
      proposed_features: z.array(
        z.object({ title: z.string(), scope: z.string() }),
      ),
    })
    .optional(),
  draft_spec_markdown: z.string().optional(),
});

export const SectionDirectionSchema = z.enum(["keep", "refine", "redirect"]);

export const SectionAnswersSchema = z.object({
  sections: z
    .record(
      z.object({
        comment: z.string().optional(),
        direction: SectionDirectionSchema.optional(),
      }),
    )
    .optional(),
  questions: z.record(z.string()).optional(),
  free_form: z.string().optional(),
});

=======
>>>>>>> origin/main
export const FeatureIterationSchema = z.object({
  id: z.string(),
  feature_id: z.string(),
  iteration: z.number().int(),
  task_id: z.string().nullable(),
  status: IterationStatusSchema,
<<<<<<< HEAD
  user_answers: SectionAnswersSchema.nullable(),
  gap_result: GapResultSchema.nullable(),
=======
  user_answers: z.unknown().nullable(),
  gap_result: z.unknown().nullable(),
>>>>>>> origin/main
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
