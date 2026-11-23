import { isMaxParallel } from "../loops/implementation-loop-max-parallel.js";
import { z } from "zod";
import {
  DigestSettingsSchema,
  TimeOfDay,
  TimeZone,
  Weekday,
} from "./digest-settings.js";
import type { ReleaseSettings } from "../release-settings.js";
import type { Assert, Equals } from "./schema-equals.js";
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

/** The implementation loop's switch, beside it the "already done?" check before its definition-of-done agent (specs/external-floor FR12.20), both off by omission, and how many ticket runs it keeps open at once, 1 by omission. */
export const ImplementationLoopSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    done_check: z.boolean().optional(),
    max_parallel: z.number().refine(isMaxParallel).optional(),
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
  /** Set once the repo's `git-history` and `github` sources were patched to `extract: false`. */
  sources_extract_off: z.boolean().optional(),
  /** Set once the repo's `git-history` source was renamed `commits` and its `github` source, which held issues, pull requests, tags and releases together, was deleted for the sources of each. */
  history_sources_split: z.boolean().optional(),
  /** Asks Utopia's AI to read the repo's commits, issues, pull requests and releases, the one repo-wide switch on top of the extraction-off default of ADR-052. */
  history_extract: z.boolean().optional(),
  /** Set once the history sources were patched to `extract: true` and re-extracted for `history_extract`. */
  history_extract_applied: z.boolean().optional(),
});

export type UtopiaMirrorSettings = z.infer<typeof UtopiaMirrorSettingsSchema>;

/** The scheduled release (specs/scheduled-releases): whether the repo publishes to its public mirror on a schedule, and when. */
export const ReleaseSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  days: z.array(Weekday).optional(),
  time: TimeOfDay.optional(),
  timezone: TimeZone.optional(),
});

/** The public repository this private one is published to, `owner/name` (specs/public-mirror). */
export const PublicMirrorSchema = z.string().regex(/^[^/\s]+\/[^/\s]+$/);

export const RepoSettingsSchema = z
  .object({
    trust: TrustSettingsSchema.optional(),
    task_types: z.array(z.string()).optional(),
    auto_review: z.boolean().optional(),
    implementation_loop: ImplementationLoopSettingsSchema.optional(),
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
    public_mirror: PublicMirrorSchema.nullable().optional(),
    release: ReleaseSettingsSchema.nullable().optional(),
  })
  .passthrough();

export type RepoSettings = z.infer<typeof RepoSettingsSchema>;
export type TrustSettings = z.infer<typeof TrustSettingsSchema>;

/** Proves the release schema and the plain type in `../release-settings.ts` are one shape; a field added to either side alone fails `tsc`. */
export type ReleaseSchemaMatchesType = Assert<
  Equals<z.infer<typeof ReleaseSettingsSchema>, ReleaseSettings>
>;
