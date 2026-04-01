/**
 * Pipeline task-type configuration loader.
 *
 * Reads task type definitions from scripts/task-types.yaml and exposes
 * helpers for prompt building, default repos, and type enumeration.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// ── Types ────────────────────────────────────────────────────────────

interface TaskTypeConfig {
  prompt_template: string;
  target_repo?: string;
  timeout_minutes: number;
  review_required: boolean;
}

// ── State ────────────────────────────────────────────────────────────

let config: Record<string, TaskTypeConfig> = {};

// ── Public API ───────────────────────────────────────────────────────

export function loadTaskTypes(): void {
  // Look for task-types.yaml in several locations
  const paths = [
    process.env.TASK_TYPES_PATH || '',
    join(process.cwd(), 'scripts', 'task-types.yaml'),
    join(process.env.CONTEXT_PATH || '', 'scripts', 'task-types.yaml'),
    join(process.env.HOME || '', '.re-cinq', 'lore', 'scripts', 'task-types.yaml'),
  ].filter(Boolean);
  for (const p of paths) {
    try {
      const raw = readFileSync(p, 'utf-8');
      const parsed = parse(raw);
      config = parsed.task_types || {};
      console.log(`[pipeline] Loaded ${Object.keys(config).length} task types from ${p}`);
      return;
    } catch {}
  }
  console.warn('[pipeline] No task-types.yaml found, using empty config');
}

export function getTaskTypeConfig(type: string): TaskTypeConfig | null {
  return config[type] || null;
}

export function getTaskTypes(): string[] {
  return Object.keys(config);
}

export function getDefaultRepo(type: string): string {
  return config[type]?.target_repo || 're-cinq/lore';
}

export function buildPrompt(type: string, description: string): string {
  const tmpl = config[type]?.prompt_template || 'Complete the following task: {description}';
  return tmpl.replace('{description}', description);
}
