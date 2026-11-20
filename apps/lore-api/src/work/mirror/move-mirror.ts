import type { FloorClient } from "@re-cinq/floor-client";
import type { SettingsPort } from "@re-cinq/lore-shared/project/settings/settings-port.js";
import { floorRepoOf } from "@re-cinq/lore-shared/floor/floor-items.js";
import type { MirrorMoveResult } from "./mirror-move-result.js";

/** The Actions variable the public repository's workflows read to know they publish a mirror. */
export const MIRROR_VARIABLE = "LORE_MIRROR";

const CANCEL_REASON = "mirror-moved";

export interface MirrorMoveFloor {
  runs: Pick<FloorClient["runs"], "list" | "cancel">;
}

export type MirrorMoveSettings = Pick<
  SettingsPort,
  "moveKnowledge" | "absorbMirrorRow" | "setRepoVariable"
>;

export interface MirrorMoveSeams {
  settings: MirrorMoveSettings;
  floor: MirrorMoveFloor | null;
}

export interface MirrorMove {
  privateRepo: string;
  mirror: string;
  dryRun: boolean;
}

/** Moves a mirror's stored knowledge to its private repo; a dry run only counts what a real run would move. */
export function moveMirror(
  seams: MirrorMoveSeams,
  move: MirrorMove,
): Promise<MirrorMoveResult> {
  return move.dryRun
    ? countMirrorMove(seams, move)
    : runMirrorMove(seams, move);
}

async function countMirrorMove(
  { settings }: MirrorMoveSeams,
  { privateRepo, mirror }: MirrorMove,
): Promise<MirrorMoveResult> {
  const tables = await settings.moveKnowledge(mirror, privateRepo, {
    dryRun: true,
  });

  return {
    mirror,
    dry_run: true,
    tables,
    cancelled_runs: [],
    mirror_row_deleted: false,
  };
}

async function runMirrorMove(
  { settings, floor }: MirrorMoveSeams,
  { privateRepo, mirror }: MirrorMove,
): Promise<MirrorMoveResult> {
  const cancelled_runs = await cancelOpenRuns(floor, mirror);
  const tables = await settings.moveKnowledge(mirror, privateRepo, {
    dryRun: false,
  });
  const mirror_variable = await markMirror(settings, mirror);

  await settings.absorbMirrorRow(mirror, privateRepo);

  return {
    mirror,
    dry_run: false,
    tables,
    cancelled_runs,
    mirror_variable,
    mirror_row_deleted: true,
  };
}

async function cancelOpenRuns(
  floor: MirrorMoveFloor | null,
  mirror: string,
): Promise<string[]> {
  if (!floor) {
    return [];
  }
  const ids = await openRunIds(floor.runs, floorRepoOf(mirror));

  await Promise.all(ids.map((id) => floor.runs.cancel(id, CANCEL_REASON)));

  return ids;
}

async function openRunIds(
  runs: MirrorMoveFloor["runs"],
  repo: string,
  cursor?: string,
): Promise<string[]> {
  const page = await runs.list(
    { repo, open: true },
    cursor ? { cursor } : undefined,
  );
  const later = page.nextCursor
    ? await openRunIds(runs, repo, page.nextCursor)
    : [];

  return [...page.items.map((run) => run.id), ...later];
}

function markMirror(
  settings: MirrorMoveSettings,
  mirror: string,
): Promise<{ set: boolean; reason?: string }> {
  return settings.setRepoVariable(mirror, MIRROR_VARIABLE, "true").then(
    () => ({ set: true }),
    (err: Error) => ({ set: false, reason: err.message }),
  );
}
