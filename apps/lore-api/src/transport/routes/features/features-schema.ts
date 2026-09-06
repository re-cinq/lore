/** Feature-planning response contracts (ADR-035); zod lives here to keep shared light. */

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

// Gap-analysis payload and author replies; keep legacy fields for schema backward-compatibility.

export const GapMockupSchema = z.object({
  title: z.string().optional(),
  format: z.enum(["svg", "mermaid", "html"]).optional(),
  markup: z.string(),
  section: z.string().optional(),
  /** Pixel height for sandboxed html mockups (they cannot measure themselves). */
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

export const FeatureIterationSchema = z.object({
  id: z.string(),
  feature_id: z.string(),
  iteration: z.number().int(),
  task_id: z.string().nullable(),
  status: IterationStatusSchema,
  user_answers: SectionAnswersSchema.nullable(),
  gap_result: GapResultSchema.nullable(),
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

/** Round start response: Station mints task_id, or resumed run reports run id + null task. */
export const RoundStartedSchema = z.object({
  iteration: z.number().int(),
  task_id: z.string().nullable().optional(),
  assembly_run_id: z.string().optional(),
  /** @deprecated pre-rename spelling; drop when web-ui no longer needs it (see runIdBothSpellings). */
  assembly_line_id: z.string().optional(),
});

export const SpecFileStartedSchema = z.object({
  task_id: z.string().optional(),
  assembly_run_id: z.string().optional(),
  /** @deprecated pre-rename spelling; drop when web-ui no longer needs it (see runIdBothSpellings). */
  assembly_line_id: z.string().optional(),
});

export const FeaturePollSchema = z.object({
  feature: FeatureSchema,
  latest_iteration: FeatureIterationSchema.nullable(),
  last_ready_iteration: FeatureIterationSchema.nullable(),
  assembly_run_id: z.string().nullable(),
  /** @deprecated pre-rename spelling; drop when web-ui no longer needs it (see runIdBothSpellings). */
  assembly_line_id: z.string().nullable(),
});

/** Emits run ID under both spellings during AssemblyRun rename; handles staggered UI rollouts. */
export function runIdBothSpellings<T extends string | null>(
  runId: T,
): { assembly_run_id: T; assembly_line_id: T } {
  return { assembly_run_id: runId, assembly_line_id: runId };
}

export const FeatureDecompositionSchema = z.object({
  tasks: z.array(
    z.object({
      description: z.string(),
      status: z.string(),
      /** Spec-task bundle: named keys + passthrough for backward compatibility. */
      context_bundle: z
        .object({
          story_issue: z.number().nullable().optional(),
          spec_task_id: z.string().optional(),
          phase: z.number().optional(),
        })
        .passthrough()
        .nullable(),
    }),
  ),
});
