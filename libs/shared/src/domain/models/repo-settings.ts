import { z } from "zod";
import { DigestSettingsSchema } from "./digest-settings.js";
import { KnowledgeBackendSchema } from "../knowledge-backend.js";

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

/** The Utopia knowledge base and source the repo's spec/ADR chain is mirrored into (specs/utopia-graph-mirror). No key: settings are served whole at read scope, so the source's push key lives in lore.utopia_sources. */
export const UtopiaMirrorSettingsSchema = z.object({
  kb_id: z.string(),
  source_id: z.string(),
  ontology_version: z.number().optional(),
  /** The newest default-branch commit the commit mirror pushed; the next walk starts above it. */
  commits_head: z.string().optional(),
  /** The update time of the newest issue or pull request the tracker mirror pushed; the next walk asks from it. */
  tracker_since: z.string().optional(),
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
    auto_merge: z
      .object({
        approver: z.enum(["none", "lore-reviewer"]).optional(),
      })
      .passthrough()
      .optional(),
    dispatch_label: z.string().optional(),
    dispatch_default_type: z.string().optional(),
    test_commands: z.unknown().optional(),
    incidents: z.array(z.unknown()).optional(),
    utopia: UtopiaMirrorSettingsSchema.optional(),
    // Which store context reads answer from when the request names none (ADR-052 amendment 2026-10-16).
    context_backend: KnowledgeBackendSchema.optional(),
  })
  .passthrough();

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
export type TrustSettings = z.infer<typeof TrustSettingsSchema>;
