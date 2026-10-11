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

export const RepoSettingsSchema = z
  .object({
    trust: TrustSettingsSchema.optional(),
    task_types: z.array(z.string()).optional(),
    auto_review: z.boolean().optional(),
    implementation_loop: z
      .object({ enabled: z.boolean().optional() })
      .passthrough()
      .optional(),
    cross_repo: z.boolean().optional(),
    cross_repo_repos: z.array(z.string()).optional(),
    slack_channel_id: z.string().optional(),
    // The daily Slack digest (specs/daily-digest FR1); posts to slack_channel_id.
    digest: DigestSettingsSchema.nullable().optional(),
    dispatch_label: z.string().optional(),
    dispatch_default_type: z.string().optional(),
    test_commands: z.unknown().optional(),
    incidents: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
export type TrustSettings = z.infer<typeof TrustSettingsSchema>;
