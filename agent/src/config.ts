/**
 * Standalone task-type configuration loader for the agent.
 *
 * Reads task type definitions from a YAML config file and exposes
 * helpers for prompt building, default repos, and type enumeration.
 */

import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';

// ── Types ────────────────────────────────────────────────────────────

export interface TaskTypeConfig {
  prompt_template: string;
  target_repo: string | null;
  timeout_minutes: number;
  review_required: boolean;
  model?: string;
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
    resolve('./task-types.yaml'),
    resolve('../scripts/task-types.yaml'),
    '/config/task-types.yaml',
  );

  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = parse(raw);
      const types: Record<string, TaskTypeConfig> = parsed.task_types || {};

      taskTypes.clear();
      for (const [name, cfg] of Object.entries(types)) {
        taskTypes.set(name, cfg);
      }

      console.log(`[agent] Loaded ${taskTypes.size} task types from ${p}`);
      return;
    } catch {
      // try next path
    }
  }

  console.warn('[agent] No task-types.yaml found, using empty config');
}

/** Return the config for a specific task type, or undefined. */
export function getTaskTypeConfig(taskType: string): TaskTypeConfig | undefined {
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
 * and to a hardcoded default if "general" is also missing.
 */
export function buildPrompt(taskType: string, description: string): string {
  const cfg = taskTypes.get(taskType) ?? taskTypes.get('general');
  const template = cfg?.prompt_template ?? 'Complete the following task: {description}';
  return template.replace('{description}', description);
}

/**
 * Return the default target repo for a task type.
 *
 * Falls back to "re-cinq/lore" when the type has no explicit target_repo.
 */
export function getDefaultRepo(taskType: string): string {
  return taskTypes.get(taskType)?.target_repo || 're-cinq/lore';
}
