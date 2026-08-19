import { z } from "zod";

/**
 * The `dark_factory` block of `lore.repos.settings` (ADR-016).
 *
 * Stored inside a JSONB column, so its keys stay SNAKE_CASE: they are the
 * storage format and the settings API's wire contract, not TypeScript fields.
 * Renaming them would be a data migration plus a breaking API change, and would
 * buy nothing — the camelCase rule applies to columns, which this is not.
 *
 * The resolver and its defaults stay in `../dark-factory-settings.js`; only the
 * shape lives here, so there is one declaration of it.
 */

export const TrustLevelSchema = z.enum([
  "docs",
  "tests",
  "implementation",
  "full",
]);
export const ReviewModeSchema = z.enum(["trust_based", "always", "never"]);
export const CreateIssueModeSchema = z.enum(["never", "on_gate", "always"]);
export const NotifyChannelSchema = z.enum(["escalation", "watched", "all"]);

export const DarkFactoryAutoMergeSchema = z.object({
  paths: z.array(z.string()).optional(),
  min_trust: TrustLevelSchema.optional(),
  require_green_ci: z.boolean().optional(),
  require_bot_approval: z.boolean().optional(),
});

/** Per-repo execution knobs. `image` is the container image a Station runs in (ADR-025). */
export const DarkFactoryExecutionSchema = z.object({
  image: z.string().optional(),
});

export const DarkFactorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  create_issue: CreateIssueModeSchema.optional(),
  auto_merge: DarkFactoryAutoMergeSchema.optional(),
  review: ReviewModeSchema.optional(),
  notify: z.array(NotifyChannelSchema).optional(),
  execution: DarkFactoryExecutionSchema.optional(),
});

/** The same block after `resolveDarkFactorySettings` has filled every default. */
export const ResolvedDarkFactorySettingsSchema = z.object({
  enabled: z.boolean(),
  create_issue: CreateIssueModeSchema,
  auto_merge: z.object({
    paths: z.array(z.string()),
    min_trust: TrustLevelSchema,
    require_green_ci: z.boolean(),
    require_bot_approval: z.boolean(),
  }),
  review: ReviewModeSchema,
  notify: z.array(NotifyChannelSchema),
});

export type TrustLevel = z.infer<typeof TrustLevelSchema>;
export type ReviewMode = z.infer<typeof ReviewModeSchema>;
export type CreateIssueMode = z.infer<typeof CreateIssueModeSchema>;
export type NotifyChannel = z.infer<typeof NotifyChannelSchema>;
export type DarkFactoryAutoMerge = z.infer<typeof DarkFactoryAutoMergeSchema>;
export type DarkFactoryExecution = z.infer<typeof DarkFactoryExecutionSchema>;
export type DarkFactorySettings = z.infer<typeof DarkFactorySettingsSchema>;
export type ResolvedDarkFactorySettings = z.infer<
  typeof ResolvedDarkFactorySettingsSchema
>;
