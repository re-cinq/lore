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

/** The auto-merge loop (specs/protected-branch-merge): whether it runs, and how long a pull request must have been open before the loop merges it; absent reads as off and 24 hours. */
export const AutoMergeSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    min_age_hours: z.number().int().min(0).optional(),
  })
  .passthrough();

/** The Utopia knowledge base the repo is mirrored into (specs/utopia-graph-mirror); naming it switches the mirror on. No keys: settings are served whole at read scope, so each source's push key lives in lore.utopia_kind_sources. */
export const UtopiaMirrorSettingsSchema = z.object({
  kb_id: z.string(),
  ontology_version: z.number().optional(),
  /** The newest default-branch commit the commit mirror pushed; the next walk starts above it. */
  commits_head: z.string().optional(),
  /** The update time of the newest issue or pull request the tracker mirror pushed; the next walk asks from it. */
  tracker_since: z.string().optional(),
  /** The id of the repo's `docs` Utopia source, which context assembly reads documents from. */
  docs_source_id: z.string().optional(),
});

export type UtopiaMirrorSettings = z.infer<typeof UtopiaMirrorSettingsSchema>;

export const RepoSettingsSchema = z
  .object({
    trust: TrustSettingsSchema.optional(),
    task_types: z.array(z.string()).optional(),
    auto_review: z.boolean().optional(),
    // The implementation loop's switch, and beside it the "already done?" check before its definition-of-done agent (specs/external-floor FR12.20); both off by omission.
    implementation_loop: z
      .object({
        enabled: z.boolean().optional(),
        done_check: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    // The issue-triage loop's switch (specs/issue-triage FR33); on when the block is absent.
    issue_triage: z
      .object({ enabled: z.boolean().optional() })
      .passthrough()
      .optional(),
    auto_merge: AutoMergeSettingsSchema.optional(),
    // The spec upkeep loop's switch; on when the block is absent.
    spec_upkeep: z
      .object({ enabled: z.boolean().optional() })
      .passthrough()
      .optional(),
    // The spec tickets loop's switch (specs/spec-tickets FR14); on when the block is absent.
    spec_tickets: z
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
    utopia: UtopiaMirrorSettingsSchema.optional(),
    // Which store context reads answer from when the request names none (ADR-052 amendment 2026-10-16).
    context_backend: KnowledgeBackendSchema.optional(),
  })
  .passthrough();

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
export type TrustSettings = z.infer<typeof TrustSettingsSchema>;
