/** Standalone task-type configuration loader for the agent: reads YAML task type definitions and exposes prompt building, default repos, and type enumeration. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  parseTaskTypesFile,
  warnOnDrift,
  type TaskTypeRecipe,
} from "@re-cinq/lore-shared/task-types/task-types-config.js";

// ── Types ────────────────────────────────────────────────────────────

export type { TaskTypeRecipe };

// ── State ────────────────────────────────────────────────────────────

const taskTypes: Map<string, TaskTypeRecipe> = new Map();

// ── Public API ───────────────────────────────────────────────────────

/** Load task type definitions from YAML, trying in order: `configPath` arg, `TASK_TYPES_PATH` env, `./task-types.yaml`, `../scripts/task-types.yaml`, `/config/task-types.yaml`. */
export function loadTaskTypes(configPath?: string): void {
  const paths: string[] = [];

  if (configPath) {
    paths.push(resolve(configPath));
  }

  if (process.env.TASK_TYPES_PATH) {
    paths.push(resolve(process.env.TASK_TYPES_PATH));
  }

  paths.push(
    resolve("./task-types.yaml"),
    resolve("../scripts/task-types.yaml"),
    "/config/task-types.yaml",
  );

  for (const p of paths) {
    try {
      const { taskTypes: types, drift } = parseTaskTypesFile(
        readFileSync(p, "utf-8"),
      );

      taskTypes.clear();
      Object.entries(types).forEach(([name, cfg]) => taskTypes.set(name, cfg));

      console.log(`[floor] Loaded ${taskTypes.size} task types from ${p}`);

      // A stale ConfigMap once blinded every review (#866) — warn rather than silently serve a shape the code no longer describes.
      warnOnDrift("[floor]", p, drift);

      return;
    } catch {
      // continue
    }
  }

  console.warn("[floor] No task-types.yaml found, using empty config");
}

/** Return the config for a specific task type, or undefined. */
export function getTaskTypeConfig(
  taskType: string,
): TaskTypeRecipe | undefined {
  return taskTypes.get(taskType);
}

/** Return the list of registered task type names. */
export function getTaskTypes(): string[] {
  return [...taskTypes.keys()];
}

/** Build a prompt for a task type, falling back to "general" then a hardcoded default — only for a TASK whose type predates the config; a node's `prompt_ref` must use {@link buildNodePrompt} instead, which refuses to substitute. */
export function buildPrompt(taskType: string, description: string): string {
  const cfg = taskTypes.get(taskType) ?? taskTypes.get("general");
  const template =
    cfg?.prompt_template ?? "Complete the following task: {description}";

  return fillDescription(template, description);
}

/** Substitute a description into `{description}` LITERALLY via a replacer function, since `String.prototype.replace`'s string form interprets `$&`/`$'`/`$1` in user input (UI/Slack/Issue text) and silently corrupted the prompt. */
export function fillDescription(template: string, description: string): string {
  return template.replace("{description}", () => description);
}

/** The prompt for an assembly-line node, resolved STRICTLY (throws on an unknown `prompt_ref`) — a silent fallback once let every push node quietly run the wrong prompt and report success for weeks with no PR opened (#1329). */
export function buildNodePrompt(
  promptRef: string,
  description: string,
): string {
  const cfg = taskTypes.get(promptRef);

  enforceTrue(
    cfg !== undefined,
    Error,
    `no prompt template named "${promptRef}" — an assembly-line node names a recipe that does not exist (known: ${getTaskTypes().join(", ")})`,
  );

  enforceTrue(
    cfg.prompt_template !== undefined,
    Error,
    `task type "${promptRef}" declares no prompt_template — the loaded task-types.yaml is older than this code`,
  );

  return fillDescription(cfg.prompt_template, description);
}

/** Return the default target repo for a task type, falling back to "re-cinq/lore". */
export function getDefaultRepo(taskType: string): string {
  return taskTypes.get(taskType)?.target_repo || "re-cinq/lore";
}
