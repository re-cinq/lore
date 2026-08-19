import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/**
 * `lore.features` — one planned feature and its lifecycle.
 *
 * DDL: migration `0017_feature_planning.sql`. `path` ("specs/<slug>") is the
 * join key into the traceability graph; `(repo, slug)` is unique. The status set
 * is enforced by `features_status_check` in the database, so the enum here and
 * the CHECK must move together.
 */

export const FeatureStatusSchema = z.enum([
  "draft",
  "planning",
  "awaiting-input",
  "spec-ready",
  "pr-open",
  "implemented",
  "split",
]);

export const FeatureSchema = z.object({
  id: z.string(),
  repo: z.string(),
  title: z.string(),
  slug: z.string(),
  path: z.string(),
  originalPrompt: z.string(),
  status: FeatureStatusSchema,
  currentIteration: z.number(),
  draftSpecMd: z.string().nullable(),
  parentFeatureId: z.string().nullable(),
  specPath: z.string().nullable(),
  specPrUrl: z.string().nullable(),
  specPrNumber: z.number().nullable(),
  issueNumber: z.number().nullable(),
  issueUrl: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;
export type Feature = z.infer<typeof FeatureSchema>;

export const FEATURE_COLUMNS = {
  id: "id",
  repo: "repo",
  title: "title",
  slug: "slug",
  path: "path",
  originalPrompt: "original_prompt",
  status: "status",
  currentIteration: "current_iteration",
  draftSpecMd: "draft_spec_md",
  parentFeatureId: "parent_feature_id",
  specPath: "spec_path",
  specPrUrl: "spec_pr_url",
  specPrNumber: "spec_pr_number",
  issueNumber: "issue_number",
  issueUrl: "issue_url",
  createdBy: "created_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<Feature>;

export const FEATURE_TABLE = "lore.features";
