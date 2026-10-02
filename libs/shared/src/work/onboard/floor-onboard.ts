// Starting a repository's onboarding on the external floor: the run is keyed on its task, works on the task's branch, and reads the onboarding ticket as a file.
import type { FloorClient } from "@re-cinq/floor-client";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  valueItem,
} from "../../outbound/floor/floor-items.js";
import { startLine } from "../review/floor-line-start.js";

export const ONBOARD_LINE = "onboard";

const TASK_ID_PREFIX = 8;

export interface OnboardFloor {
  lines: Pick<FloorClient["lines"], "start">;
  blobs: Pick<FloorClient["blobs"], "put">;
}

export interface OnboardStart {
  repo: string;
  /** The onboarding branch, which must already exist: the floor clones it when the first visit opens. */
  branch: string;
  taskId: string;
  ticket: string;
}

export function onboardBranchOf(taskId: string): string {
  return `lore/onboard/${taskId.substring(0, TASK_ID_PREFIX)}`;
}

/** The id of the run started, or of the open one this start joined. */
export async function startOnboardRun(
  floor: OnboardFloor,
  { repo, branch, taskId, ticket }: OnboardStart,
): Promise<string> {
  const stored = await floor.blobs.put(
    new TextEncoder().encode(ticket),
    "text/markdown",
  );
  const started = await startLine(floor.lines, ONBOARD_LINE, {
    repo: floorRepoOf(repo),
    startItems: {
      repo: gitItem(repo, branch),
      task_id: valueItem(taskId),
      ticket: fileItem(stored.hash),
    },
  });

  return started.run.id;
}
