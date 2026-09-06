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
  // Look for task-types.yaml in several locations
  const paths = [
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

  for (const p of paths) {
    try {
      const { taskTypes, drift } = parseTaskTypesFile(readFileSync(p, "utf-8"));

      config = taskTypes;
      console.log(
        `[pipeline] Loaded ${Object.keys(config).length} task types from ${p}`,
      );
      // Same #866 ConfigMap risk as Floor's reader — warn rather than ignore.
      warnOnDrift("[pipeline]", p, drift);

      return;
    } catch {
      // ignore malformed candidate; try the next path
    }
  }
  console.warn("[pipeline] No task-types.yaml found, using empty config");
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

function resolvePromptTemplate(
  overridePromptTemplate: unknown,
  baseRecipe: TaskTypeRecipe,
): string {
  if (typeof overridePromptTemplate === "string" && overridePromptTemplate) {
    return overridePromptTemplate;
  }

  return baseRecipe.prompt_template || DEFAULT_PROMPT;
}

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
