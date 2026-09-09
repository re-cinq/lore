/** Pipeline task-type configuration loader. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTaskTypesFile,
  warnOnDrift,
  type TaskTypeRecipe,
} from "@re-cinq/lore-shared/task-types/task-types-config.js";

const DEFAULT_PROMPT = "Complete the following task: {description}";

// ── State ────────────────────────────────────────────────────────────

let config: Record<string, TaskTypeRecipe> = {};

// ── Public API ───────────────────────────────────────────────────────

export function loadTaskTypes(): void {
  for (const path of candidatePaths()) {
    if (tryLoad(path)) {
      return;
    }
  }
  console.warn("[pipeline] No task-types.yaml found, using empty config");
}

// Where task-types.yaml might be, most specific first: an explicit override, the working tree, the mounted context, then a developer's install.
function candidatePaths(): string[] {
  return [
    process.env.TASK_TYPES_PATH || "",
    join(process.cwd(), "scripts", "task-types.yaml"),
    join(process.env.CONTEXT_PATH || "", "scripts", "task-types.yaml"),
    join(
      process.env.HOME || "",
      ".re-cinq",
      "lore",
      "scripts",
      "task-types.yaml",
    ),
  ].filter(Boolean);
}

// One candidate. A malformed or missing file is skipped so the next path gets a turn — but drift in a file that DID parse is warned about rather than ignored, the same #866 ConfigMap risk the Floor's reader carries.
function tryLoad(path: string): boolean {
  try {
    const { taskTypes, drift } = parseTaskTypesFile(
      readFileSync(path, "utf-8"),
    );

    config = taskTypes;
    console.log(
      `[pipeline] Loaded ${Object.keys(config).length} task types from ${path}`,
    );
    warnOnDrift("[pipeline]", path, drift);

    return true;
  } catch {
    return false;
  }
}

export function getTaskTypeConfig(type: string): TaskTypeRecipe | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- config is a Record keyed by whatever task-types.yaml declared; an unknown `type` genuinely has no entry
  return config[type] || null;
}

export function getTaskTypes(): string[] {
  return Object.keys(config);
}

export function getDefaultRepo(type: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- config is a Record keyed by whatever task-types.yaml declared; an unknown `type` genuinely has no entry
  return config[type]?.target_repo || "re-cinq/lore";
}

export function buildPrompt(type: string, description: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- config is a Record keyed by whatever task-types.yaml declared; an unknown `type` genuinely has no entry
  const tmpl = config[type]?.prompt_template || DEFAULT_PROMPT;

  return tmpl.replace("{description}", description);
}

const DEFAULT_BASE_RECIPE: TaskTypeRecipe = {
  prompt_template: DEFAULT_PROMPT,
  timeout_minutes: 30,
  review_required: false,
};

/** Merge global task type config with per-repo overrides; repo overrides win. */
export function getTaskTypeConfigForRepo(
  type: string,
  repoSettings:
    | { task_overrides?: Record<string, Record<string, unknown>> }
    | null
    | undefined,
): TaskTypeRecipe & { system_prompt_suffix?: string } {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- config is a Record keyed by whatever task-types.yaml declared; an unknown `type` genuinely has no entry
  const base = config[type] || DEFAULT_BASE_RECIPE;
  const overrides = repoSettings?.task_overrides?.[type] || {};

  return {
    ...base,
    ...overrides,
    prompt_template: resolvePromptTemplate(overrides.prompt_template, base),
  };
}

function resolvePromptTemplate(
  overridePromptTemplate: unknown,
  baseRecipe: TaskTypeRecipe,
): string {
  if (typeof overridePromptTemplate === "string" && overridePromptTemplate) {
    return overridePromptTemplate;
  }

  return baseRecipe.prompt_template || DEFAULT_PROMPT;
}
