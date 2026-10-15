import { z } from "zod";
import { DigestSettingsSchema } from "./digest-settings.js";

/** The lore.repos.settings JSONB column; SNAKE_CASE keys; unknown keys pass through; every key is optional. */

export const TrustLevelSchema = z.enum([
  "docs",
  "tests",
  "implementation",
  "full",
]);

export type TrustLevel = z.infer<typeof TrustLevelSchema>;

/** Progressive trust ladder state (#1354): merges banked at the current level, promoted on `auto_promote_threshold`. */
export const TrustSettingsSchema = z
  .object({
    level: TrustLevelSchema.optional(),
    successful_tasks: z.number().optional(),
    auto_promote_threshold: z.number().optional(),
  })
  .passthrough();

/** Who approves Lore's PRs on a protected branch (specs/protected-branch-merge); absent reads as none. */
export const AutoMergeSettingsSchema = z
  .object({
    approver: z.enum(["none", "lore-reviewer"]).optional(),
  })
  .passthrough();

/** The Utopia knowledge base the repo's spec/ADR chain is mirrored into (specs/utopia-graph-mirror); the key is the one source's own push key, written by the setup route. */
export const UtopiaMirrorSettingsSchema = z.object({
  kb_id: z.string(),
  source_id: z.string(),
  source_key: z.string(),
  ontology_version: z.number().optional(),
});

export type UtopiaMirrorSettings = z.infer<typeof UtopiaMirrorSettingsSchema>;

export const RepoSettingsSchema = z
  .object({
    trust: TrustSettingsSchema.optional(),
    task_types: z.array(z.string()).optional(),
    auto_review: z.boolean().optional(),
    implementation_loop: z
      .object({ enabled: z.boolean().optional() })
      .passthrough()
      .optional(),
    auto_merge: AutoMergeSettingsSchema.optional(),
    cross_repo: z.boolean().optional(),
    cross_repo_repos: z.array(z.string()).optional(),
    slack_channel_id: z.string().optional(),
    // The daily Slack digest (specs/daily-digest FR1); posts to slack_channel_id.
    digest: DigestSettingsSchema.nullable().optional(),
    dispatch_label: z.string().optional(),
    dispatch_default_type: z.string().optional(),
    test_commands: z.unknown().optional(),
    incidents: z.array(z.unknown()).optional(),
    utopia: UtopiaMirrorSettingsSchema.optional(),
  })
  .passthrough();

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
export type TrustSettings = z.infer<typeof TrustSettingsSchema>;
