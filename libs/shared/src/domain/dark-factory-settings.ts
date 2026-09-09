/** DEPENDENCY-FREE by design: web-ui imports this by relative path (no zod in its lockfile); models/dark-factory-settings.ts asserts at compile time that its schema infers exactly these types. */

export type TrustLevel = "docs" | "tests" | "implementation" | "full";
export type ReviewMode = "trust_based" | "always" | "never";
export type CreateIssueMode = "never" | "on_gate" | "always";
export type NotifyChannel = "escalation" | "watched" | "all";

// Held to models/dark-factory-settings.ts's DarkFactoryAutoMergeSchema by a compile-time assertion, same as PipelineTask.
// eslint-disable-next-line re-lint/no-row-types-outside-models
export interface DarkFactoryAutoMerge {
  paths?: string[];
  min_trust?: TrustLevel;
  require_green_ci?: boolean;
  require_bot_approval?: boolean;
}

/** Per-repo execution knobs; `image` is the container image a task's Station runs in (ADR-025). */
export interface DarkFactoryExecution {
  image?: string;
}

export interface DarkFactorySettings {
  enabled?: boolean;
  create_issue?: CreateIssueMode;
  auto_merge?: DarkFactoryAutoMerge;
  review?: ReviewMode;
  notify?: NotifyChannel[];
  execution?: DarkFactoryExecution;
}

export interface ResolvedDarkFactorySettings {
  enabled: boolean;
  create_issue: CreateIssueMode;
  auto_merge: {
    paths: string[];
    min_trust: TrustLevel;
    require_green_ci: boolean;
    require_bot_approval: boolean;
  };
  review: ReviewMode;
  notify: NotifyChannel[];
}

export const DEFAULT_AUTO_MERGE_PATHS = [
  "specs/**",
  "adrs/**",
  "*.md",
  "CLAUDE.md",
  ".claude/**",
];

function orDefault<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

function resolveEnabled(
  partial: DarkFactorySettings | null | undefined,
): boolean {
  return partial?.enabled ?? false;
}

function resolveAutoMerge(
  autoMerge: DarkFactoryAutoMerge = {},
): ResolvedDarkFactorySettings["auto_merge"] {
  return {
    paths: orDefault(autoMerge.paths, DEFAULT_AUTO_MERGE_PATHS),
    min_trust: orDefault(autoMerge.min_trust, "docs"),
    require_green_ci: autoMerge.require_green_ci ?? true,
    require_bot_approval: autoMerge.require_bot_approval ?? true,
  };
}

interface ModeDefaults {
  create_issue: CreateIssueMode;
  review: ReviewMode;
  notify: NotifyChannel[];
}

/** Dark mode narrows Issues to the gate, trusts the bot review, and stays quiet; the conservative opt-out keeps all three wide open. */
const DARK_DEFAULTS: ModeDefaults = {
  create_issue: "on_gate",
  review: "trust_based",
  notify: [],
};

const SUPERVISED_DEFAULTS: ModeDefaults = {
  create_issue: "always",
  review: "always",
  notify: ["all"],
};

/** Applies defaults to a partial settings doc (dark-mode-on vs. conservative opt-out); an empty notify list in dark mode is correct since decideNotify always fires escalation regardless. */
export function resolveDarkFactorySettings(
  partial: DarkFactorySettings | null | undefined,
): ResolvedDarkFactorySettings {
  const settings = partial ?? {};
  const enabled = resolveEnabled(settings);
  const defaults = enabled ? DARK_DEFAULTS : SUPERVISED_DEFAULTS;

  return {
    enabled,
    create_issue: settings.create_issue ?? defaults.create_issue,
    auto_merge: resolveAutoMerge(settings.auto_merge),
    review: settings.review ?? defaults.review,
    notify: settings.notify ?? [...defaults.notify],
  };
}

/** docs(1) < tests(2) < implementation(3) < full(4) */
const TRUST_ORDER: Record<TrustLevel, number> = {
  docs: 1,
  tests: 2,
  implementation: 3,
  full: 4,
};

export function trustMeets(
  actual: TrustLevel | undefined,
  min: TrustLevel,
): boolean {
  if (!actual) {
    return false;
  }

  return TRUST_ORDER[actual] >= TRUST_ORDER[min];
}

/** The container image a task runs in by default (ADR-025). */
export const DEFAULT_EXECUTION_IMAGE =
  "ghcr.io/re-cinq/lore-claude-runner:latest";

/** Repo settings shape needed to resolve a task's execution image. */
export interface ExecutionImageSettings {
  dark_factory?: DarkFactorySettings | null;
  task_overrides?: Record<
    string,
    { execution?: DarkFactoryExecution } | undefined
  > | null;
}

function taskOverrideImage(
  settings: ExecutionImageSettings | null | undefined,
  taskType: string,
): string | undefined {
  const overrides = settings?.task_overrides;

  if (!overrides) {
    return undefined;
  }

  const override = overrides[taskType];

  return override?.execution?.image;
}

function darkFactoryImage(
  settings: ExecutionImageSettings | null | undefined,
): string | undefined {
  const darkFactory = settings?.dark_factory;

  return darkFactory?.execution?.image;
}

/** Resolves a task's Station image, newest-wins: per-task-type override → per-repo dark_factory.execution.image → platform default (ADR-025). */
export function resolveExecutionImage(
  settings: ExecutionImageSettings | null | undefined,
  taskType: string,
): string {
  return (
    taskOverrideImage(settings, taskType) ??
    darkFactoryImage(settings) ??
    DEFAULT_EXECUTION_IMAGE
  );
}
