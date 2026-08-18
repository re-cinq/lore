/**
 * Standalone task-type configuration loader for the agent.
 *
 * Reads task type definitions from a YAML config file and exposes
 * helpers for prompt building, default repos, and type enumeration.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

// ── Types ────────────────────────────────────────────────────────────

export interface TaskTypeConfig {
  prompt_template: string;
  target_repo: string | null;
  timeout_minutes: number;
  review_required: boolean;
  model?: string;
  // "claude-code" (default, LLM) or "graph-ingest" (deterministic, zero-LLM).
  // Absent is treated as "claude-code" so existing task types are unchanged.
  execution_mode?: string;
}

// ── State ────────────────────────────────────────────────────────────

const taskTypes: Map<string, TaskTypeConfig> = new Map();

// ── Public API ───────────────────────────────────────────────────────

/**
 * Load task type definitions from YAML.
 *
 * Resolution order:
 *  1. Explicit `configPath` argument
 *  2. `TASK_TYPES_PATH` env variable
 *  3. `./task-types.yaml` (cwd)
 *  4. `../scripts/task-types.yaml` (repo root scripts/)
 *  5. `/config/task-types.yaml` (container mount)
 */
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
      const raw = readFileSync(p, "utf-8");
      const parsed = parse(raw);
      const types: Record<string, TaskTypeConfig> = parsed.task_types || {};

      taskTypes.clear();

      for (const [name, cfg] of Object.entries(types)) {
        taskTypes.set(name, cfg);
      }

      console.log(`[floor] Loaded ${taskTypes.size} task types from ${p}`);

      return;
    } catch {
      // try next path
    }
  }

  console.warn("[floor] No task-types.yaml found, using empty config");
}

/** Return the config for a specific task type, or undefined. */
export function getTaskTypeConfig(
  taskType: string,
): TaskTypeConfig | undefined {
  return taskTypes.get(taskType);
}

/** Return the list of registered task type names. */
export function getTaskTypes(): string[] {
  return [...taskTypes.keys()];
}

/**
 * Build a prompt string for the given task type and description.
 *
 * Falls back to the "general" type if `taskType` is not found,
 * and to a hardcoded default if "general" is also missing. That fallback is for
 * a TASK whose type predates the config; a node naming a `prompt_ref` must use
 * {@link buildNodePrompt}, which refuses to substitute a different recipe.
 */
export function buildPrompt(taskType: string, description: string): string {
  const cfg = taskTypes.get(taskType) ?? taskTypes.get("general");
  const template =
    cfg?.prompt_template ?? "Complete the following task: {description}";

  return template.replace("{description}", description);
}

/**
 * The prompt for an assembly-line node — resolved STRICTLY, throwing when the
 * `prompt_ref` names nothing.
 *
 * A node's `prompt_ref` is a claim about which recipe the node runs, and the
 * silent fallback made it unfalsifiable: every push node in the platform
 * declared `prompt_ref: push-only`, no such task type ever existed, and so every
 * one of them quietly ran the GENERAL prompt — "complete the following task" —
 * against the whole feature description. They edited files, committed, exited 0
 * and reported success, for weeks, while no line opened a PR (#1329). A missing
 * recipe is a broken blueprint; running a different one and calling it success
 * is the failure mode that hid it.
 */
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

  return cfg.prompt_template.replace("{description}", description);
}

/**
 * Return the default target repo for a task type.
 *
 * Falls back to "re-cinq/lore" when the type has no explicit target_repo.
 */
export function getDefaultRepo(taskType: string): string {
  return taskTypes.get(taskType)?.target_repo || "re-cinq/lore";
}
