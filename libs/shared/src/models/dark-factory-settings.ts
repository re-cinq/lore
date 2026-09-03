import type {
  DarkFactorySettings,
  ResolvedDarkFactorySettings,
} from "../dark-factory-settings.js";
import { z } from "zod";

/** The `dark_factory` block of `lore.repos.settings` (ADR-016); JSONB storage, so keys stay snake_case (the wire contract, not TS fields). Resolver + defaults stay in `../dark-factory-settings.js` — only the shape lives here. */

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

export type {
  CreateIssueMode,
  DarkFactoryAutoMerge,
  DarkFactoryExecution,
  DarkFactorySettings,
  NotifyChannel,
  ResolvedDarkFactorySettings,
  ReviewMode,
  TrustLevel,
} from "../dark-factory-settings.js";

type Assert<T extends true> = T;

/** Identity-based equality, not a bidirectional `extends` — an `extends` pair can't see an added OPTIONAL field (`{a?: x}` and `{}` each extend the other). */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Proves the schemas above and the plain types in `../dark-factory-settings.ts` are one shape (kept separate only because that module must stay dependency-free for web-ui); a field added to either side alone fails `tsc`. */
type SchemaMatchesTypes = Assert<
  Equals<z.infer<typeof DarkFactorySettingsSchema>, DarkFactorySettings>
> &
  Assert<
    Equals<
      z.infer<typeof ResolvedDarkFactorySettingsSchema>,
      ResolvedDarkFactorySettings
    >
  >;

export type { SchemaMatchesTypes };
