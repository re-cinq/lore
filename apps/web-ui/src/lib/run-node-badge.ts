// The one line of facts drawn inside a graph node (run-viz FR4.15): the model it runs on, how long it has been at it, and how many times it has been visited.

import type { AssemblyRunNode } from "./assembly-run-rows";
import { formatDuration } from "./assembly-run-presenter";
import type { NodeModel } from "./node-models";
import { modelShortLabel } from "./node-models";
import type { NodeRunState } from "./run-event-reducer";

export interface NodeBadgeMeta {
  model: string | null;
  durationSeconds: number | null;
  iteration: number;
}

export interface NodeBadgeInput {
  row: AssemblyRunNode | undefined;
  state: NodeRunState | undefined;
  model: NodeModel | undefined;
  /** The ticking clock a running node measures against. */
  now: string;
}

/** Seconds a running visit has been at it, counted from its start; null when it is not running or never started. */
function liveElapsed(
  row: AssemblyRunNode | undefined,
  state: NodeRunState | undefined,
  now: string,
): number | null {
  if (state?.status !== "running" || !row?.startedAt) {
    return null;
  }

  return Math.max(
    0,
    Math.round((Date.parse(now) - Date.parse(row.startedAt)) / 1000),
  );
}

/** A finished visit reports its recorded duration; a running one counts from its start; a node with neither has none. */
function elapsedSeconds(
  row: AssemblyRunNode | undefined,
  state: NodeRunState | undefined,
  now: string,
): number | null {
  return row?.durationSeconds ?? liveElapsed(row, state, now);
}

export function nodeBadgeMeta({
  row,
  state,
  model,
  now,
}: NodeBadgeInput): NodeBadgeMeta {
  return {
    model: model ? modelShortLabel(model.model) : null,
    durationSeconds: elapsedSeconds(row, state, now),
    iteration: row?.iteration ?? state?.iteration ?? 0,
  };
}

/** `Sonnet 4.6 · 3m 12s · ×2` — each part only when it says something; an unvisited node with no model reads as nothing at all. */
export function formatNodeMeta(meta: NodeBadgeMeta): string {
  const parts = [
    meta.model,
    meta.durationSeconds === null ? null : formatDuration(meta.durationSeconds),
    meta.iteration >= 2 ? `×${meta.iteration}` : null,
  ];

  return parts.filter((part): part is string => part !== null).join(" · ");
}
