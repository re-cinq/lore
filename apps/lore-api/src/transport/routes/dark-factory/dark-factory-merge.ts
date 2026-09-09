// The pure settings-merge layer for a dark-factory PUT: parse the body, then fold the patch (and any task_overrides patch) over the row's stored JSONB settings.

import {
  parseDarkFactorySettings,
  parseTaskOverrides,
  type DarkFactorySettings,
  type TaskOverridesPatch,
} from "../../../work/dark-factory/dark-factory-settings.js";
import type { DarkFactoryState } from "../../../work/dark-factory/baseline-capture.js";

/** Both halves of a settings PUT: the dark_factory patch and the optional per-task-type siblings. */
export interface SettingsPatch {
  patch: DarkFactorySettings;
  toPatch: TaskOverridesPatch | undefined;
}

/** Reads the body, or says why it cannot. */
export function parseSettingsBody(
  body: unknown,
): SettingsPatch | { error: { error: string; issues: unknown } } {
  try {
    // task_overrides[*].execution.image is two-key gated like dark_factory.execution.image (ADR-025).
    const rawTo = (body as { task_overrides?: unknown } | null)?.task_overrides;

    return {
      patch: parseDarkFactorySettings(body),
      toPatch: rawTo !== undefined ? parseTaskOverrides(rawTo) : undefined,
    };
  } catch (err) {
    return {
      error: { error: "invalid_settings", issues: issuesFromParseError(err) },
    };
  }
}

/** Zod's issue list is passed through untouched — a caller fixing a rejected patch needs the field, not a summary. */
function issuesFromParseError(err: unknown): unknown {
  return typeof err === "object" && err !== null && "issues" in err
    ? (err as { issues: unknown }).issues
    : (err as Error).message;
}

export interface AppliedPatch {
  settings: Record<string, unknown>;
  prev: {
    dark_factory: DarkFactoryState;
    task_overrides: Record<string, Record<string, unknown>>;
  };
  next: DarkFactoryState;
}

/** Pure merge step: folds the patch (and optional task_overrides patch) over the row's current JSONB settings. */
export function applyPatch(
  stored: Record<string, unknown> | null,
  patch: DarkFactorySettings,
  toPatch: TaskOverridesPatch | undefined,
): AppliedPatch {
  const settings: Record<string, unknown> = stored ?? {};
  const { prev, prevTo } = storedBlocks(settings);
  const next = mergedDarkFactory(prev, patch);

  settings.dark_factory = next;
  settings.task_overrides = toPatch
    ? mergedTaskOverrides(prevTo, toPatch)
    : prevTo;

  return {
    settings,
    prev: { dark_factory: prev, task_overrides: prevTo },
    next,
  };
}

/** The two blocks the patch folds over, read out of the row's JSONB before anything is written back. An absent block reads as empty — a repo that never had settings is not an error. */
function storedBlocks(settings: Record<string, unknown>) {
  return {
    prev: (settings.dark_factory ?? {}) as DarkFactoryState,
    prevTo: (settings.task_overrides ?? {}) as Record<
      string,
      Record<string, unknown>
    >,
  };
}

/** Shallow-merge, except the two nested blocks a caller patches one key of at a time. Stored settings are JSONB, so `prev` is the loose shape the column actually holds. */
function mergedDarkFactory(
  prev: DarkFactoryState,
  patch: DarkFactorySettings,
): DarkFactoryState {
  const next: DarkFactoryState = { ...prev, ...patch };

  if (patch.auto_merge) {
    next.auto_merge = { ...nested(prev.auto_merge), ...patch.auto_merge };
  }

  if (patch.execution) {
    next.execution = { ...nested(prev.execution), ...patch.execution };
  }

  return next;
}

function nested(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

/** Deep-merges every touched task type over its existing entry; untouched types stay intact. */
function mergedTaskOverrides(
  prevTo: Record<string, Record<string, unknown>>,
  toPatch: TaskOverridesPatch,
): Record<string, Record<string, unknown>> {
  const nextTo: Record<string, Record<string, unknown>> = { ...prevTo };

  for (const [type, ov] of Object.entries(toPatch)) {
    nextTo[type] = mergedTaskOverride(prevTo[type], ov);
  }

  return nextTo;
}

/** Deep-merges one task-type override patch (and its nested `execution`) over the stored entry. */
function mergedTaskOverride(
  prev: Record<string, unknown> | undefined,
  patch: TaskOverridesPatch[string],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(prev ?? {}), ...patch };

  if (patch.execution) {
    const prevExecution = (prev?.execution ?? {}) as Record<string, unknown>;

    merged.execution = { ...prevExecution, ...patch.execution };
  }

  return merged;
}
