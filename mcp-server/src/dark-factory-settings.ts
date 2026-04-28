import { z } from "zod";

/**
 * Per-repo dark-factory settings. Stored under
 * `lore.repos.settings.dark_factory`. All sub-fields are optional;
 * the loader applies sensible defaults that match
 * `data-model.md`.
 */
const TrustLevel = z.enum(["docs", "tests", "implementation", "full"]);

const AutoMergeSchema = z.object({
  paths: z.array(z.string()).max(32).optional(),
  min_trust: TrustLevel.optional(),
  require_green_ci: z.boolean().optional(),
  require_bot_approval: z.boolean().optional(),
});

const NotifyChannel = z.enum(["escalation", "watched", "all"]);

export const DarkFactorySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  create_issue: z.enum(["never", "on_gate", "always"]).optional(),
  auto_merge: AutoMergeSchema.optional(),
  review: z.enum(["trust_based", "always", "never"]).optional(),
  notify: z.array(NotifyChannel).optional(),
});

export type DarkFactorySettings = z.infer<typeof DarkFactorySettingsSchema>;
export type DarkFactoryAutoMerge = z.infer<typeof AutoMergeSchema>;
export type DarkFactoryTrustLevel = z.infer<typeof TrustLevel>;

export interface ResolvedDarkFactorySettings {
  enabled: boolean;
  create_issue: "never" | "on_gate" | "always";
  auto_merge: {
    paths: string[];
    min_trust: DarkFactoryTrustLevel;
    require_green_ci: boolean;
    require_bot_approval: boolean;
  };
  review: "trust_based" | "always" | "never";
  notify: Array<"escalation" | "watched" | "all">;
}

const DEFAULT_AUTO_MERGE_PATHS = [
  "specs/**",
  "adrs/**",
  "*.md",
  "CLAUDE.md",
  ".claude/**",
];

/**
 * Apply defaults to a (possibly partial) parsed settings document. The
 * defaults differ between dark-mode-on (`enabled: true`) and the
 * conservative opt-out posture.
 */
export function resolveSettings(
  partial: DarkFactorySettings | null | undefined,
): ResolvedDarkFactorySettings {
  const enabled = partial?.enabled ?? false;
  return {
    enabled,
    create_issue: partial?.create_issue ?? (enabled ? "on_gate" : "always"),
    auto_merge: {
      paths: partial?.auto_merge?.paths ?? DEFAULT_AUTO_MERGE_PATHS,
      min_trust: partial?.auto_merge?.min_trust ?? "docs",
      require_green_ci: partial?.auto_merge?.require_green_ci ?? true,
      require_bot_approval:
        partial?.auto_merge?.require_bot_approval ?? true,
    },
    review: partial?.review ?? (enabled ? "trust_based" : "always"),
    notify: partial?.notify ?? (enabled ? ["escalation"] : ["all"]),
  };
}

/**
 * Validates a partial settings patch. Throws ZodError on invalid
 * shape. The two-key check (FR3.9) is enforced separately by
 * {@link requireTwoKey}.
 */
export function parseDarkFactorySettings(
  raw: unknown,
): DarkFactorySettings {
  return DarkFactorySettingsSchema.parse(raw);
}

/**
 * Returns the field paths in `patch` that require the two-key ceremony
 * (admin scope + CODEOWNERS-approval PR). Per FR3.9 + R9.
 *
 * Two-key fields:
 *   - dark_factory.enabled (any change to)
 *   - dark_factory.auto_merge.paths (any change)
 *   - dark_factory.auto_merge.require_green_ci (only when set to false — downgrade)
 *   - dark_factory.auto_merge.require_bot_approval (only when set to false — downgrade)
 *
 * All other sub-fields require admin scope only.
 */
export function twoKeyFieldsTouched(
  patch: DarkFactorySettings,
): string[] {
  const touched: string[] = [];
  if (patch.enabled !== undefined) touched.push("enabled");
  if (patch.auto_merge?.paths !== undefined) touched.push("auto_merge.paths");
  if (patch.auto_merge?.require_green_ci === false) {
    touched.push("auto_merge.require_green_ci");
  }
  if (patch.auto_merge?.require_bot_approval === false) {
    touched.push("auto_merge.require_bot_approval");
  }
  return touched;
}

/**
 * Compares trust levels. Returns true when `actual` ≥ `min` per the
 * docs < tests < implementation < full ordering.
 */
const TRUST_ORDER: Record<DarkFactoryTrustLevel, number> = {
  docs: 1,
  tests: 2,
  implementation: 3,
  full: 4,
};

export function trustMeets(
  actual: DarkFactoryTrustLevel | undefined,
  min: DarkFactoryTrustLevel,
): boolean {
  if (!actual) return false;
  return TRUST_ORDER[actual] >= TRUST_ORDER[min];
}
