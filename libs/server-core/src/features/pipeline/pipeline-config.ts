/**
 * Pipeline task-type configuration loader.
 *
 * Reads task type definitions from scripts/task-types.yaml and exposes
 * helpers for prompt building, default repos, and type enumeration.
 */

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
      // Same ConfigMap, same #866 risk as the Floor's reader — reported here
      // too rather than left for whichever process happens to log it.
      warnOnDrift("[pipeline]", p, drift);

      return;
    } catch {
      // ignore malformed candidate; try the next path
    }
  }
  console.warn("[pipeline] No task-types.yaml found, using empty config");
}

export function getTaskTypeConfig(type: string): TaskTypeRecipe | null {
  return config[type] || null;
}

export function getTaskTypes(): string[] {
  return Object.keys(config);
}

export function getDefaultRepo(type: string): string {
  return config[type]?.target_repo || "re-cinq/lore";
}

export function buildPrompt(type: string, description: string): string {
  const tmpl = config[type]?.prompt_template || DEFAULT_PROMPT;

  return tmpl.replace("{description}", description);
}

/**
 * Merge global task type config with per-repo overrides from lore.repos.settings.task_overrides.
 * Repo overrides win for any field they specify.
 */
export function getTaskTypeConfigForRepo(
  type: string,
  repoSettings:
    | { task_overrides?: Record<string, Record<string, unknown>> }
    | null
    | undefined,
): TaskTypeRecipe & { system_prompt_suffix?: string } {
  const base = config[type] || {
    prompt_template: DEFAULT_PROMPT,
    timeout_minutes: 30,
    review_required: false,
  };
  const overrides = repoSettings?.task_overrides?.[type] || {};

  return {
    ...base,
    ...overrides,
    // Always use base prompt_template unless explicitly overridden
    prompt_template:
      (overrides.prompt_template as string) ||
      base.prompt_template ||
      DEFAULT_PROMPT,
  };
}
