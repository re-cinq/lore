import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";
import { RepoSettingsSchema } from "./repo-settings.js";

/**
 * `lore.repos` — one onboarded repository.
 *
 * DDL: `scripts/infra/setup-repos-schema.sh` (the `outcome_stats` column is added
 * by the idempotent ALTER at the foot of the same file).
 *
 * `fullName` (`owner/name`) is the identifier every other schema keys a repo by;
 * `id` exists but is referenced only by `lore.agent_definitions.project_id`.
 */

export const RepoSchema = z.object({
  id: z.string(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  team: z.string().nullable(),
  onboardedAt: z.date(),
  lastIngestedAt: z.date().nullable(),
  onboardingPrUrl: z.string().nullable(),
  onboardingPrMerged: z.boolean(),
  settings: RepoSettingsSchema.nullable(),
  outcomeStats: z.record(z.unknown()).nullable(),
});

export type Repo = z.infer<typeof RepoSchema>;

export const REPO_COLUMNS = {
  id: "id",
  owner: "owner",
  name: "name",
  fullName: "full_name",
  team: "team",
  onboardedAt: "onboarded_at",
  lastIngestedAt: "last_ingested_at",
  onboardingPrUrl: "onboarding_pr_url",
  onboardingPrMerged: "onboarding_pr_merged",
  settings: "settings",
  outcomeStats: "outcome_stats",
} as const satisfies ColumnMap<Repo>;

/** The table this model owns — read by the models drift test. */
export const REPO_TABLE = "lore.repos";
