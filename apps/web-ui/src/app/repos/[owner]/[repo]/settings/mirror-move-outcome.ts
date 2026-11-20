import type { ApiResult } from "@/lib/api/result";
import type { components } from "@/lib/api/schema";

type MirrorMoveResult = components["schemas"]["MirrorMoveResult"];

export interface MoveSummary {
  mirror: string;
  dryRun: boolean;
  /** The tables where something moved or was kept; a table holding 0 and 0 is left out. */
  tables: { table: string; moved: number; keptConflict: number }[];
  totalMoved: number;
  nothingToMove: boolean;
  cancelledRuns: number;
  variableNote: string | null;
  rowDeleted: boolean;
}

export type MirrorMoveOutcome =
  { ok: true; summary: MoveSummary } | { ok: false; said: string };

export interface MirrorMoveRequest {
  confirm?: string;
  dry_run: boolean;
}

/** Asks lore-api to preview or do the move and answers what the card shows. */
export type MirrorMove = (
  request: MirrorMoveRequest,
) => Promise<MirrorMoveOutcome>;

const REFUSALS: Record<number, string> = {
  403: "only an admin can move it",
  409: "this repository has no public mirror saved",
};

/** The route's answer as counts and notes, or its refusal as one plain sentence. */
export function mirrorMoveOutcome(
  result: ApiResult<MirrorMoveResult>,
): MirrorMoveOutcome {
  if (result.status === "ok") {
    return { ok: true, summary: summarize(result.data) };
  }

  return {
    ok: false,
    said: `Could not move the mirror's knowledge: ${reasonOf(result)}.`,
  };
}

function reasonOf(result: Exclude<ApiResult<unknown>, { status: "ok" }>) {
  if (result.status === "unconfigured") {
    return "Lore API unconfigured";
  }

  return REFUSALS[result.code ?? 0] ?? result.message;
}

function summarize(result: MirrorMoveResult): MoveSummary {
  const tables = touchedTables(result);

  return {
    mirror: result.mirror,
    dryRun: result.dry_run,
    tables,
    totalMoved: tables.reduce((sum, row) => sum + row.moved, 0),
    nothingToMove: tables.length === 0,
    cancelledRuns: result.cancelled_runs.length,
    variableNote: variableNote(result),
    rowDeleted: result.mirror_row_deleted,
  };
}

function touchedTables(result: MirrorMoveResult): MoveSummary["tables"] {
  const touched = result.tables.filter(
    (row) => row.moved + row.kept_conflict > 0,
  );

  return touched.map((row) => ({
    table: row.table,
    moved: row.moved,
    keptConflict: row.kept_conflict,
  }));
}

function variableNote(result: MirrorMoveResult): string | null {
  const variable = result.mirror_variable;

  if (!variable) {
    return null;
  }

  return variable.set
    ? `LORE_MIRROR was set on ${result.mirror}`
    : `LORE_MIRROR was not set on ${result.mirror}: ${variable.reason ?? "no reason given"}`;
}

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What a finished move did, one sentence per line. */
export function outcomeLines(summary: MoveSummary): string[] {
  return [
    `${plural(summary.totalMoved, "row")} moved to this repository.`,
    `${plural(summary.cancelledRuns, "run")} cancelled.`,
    summary.variableNote && `${summary.variableNote}.`,
    summary.rowDeleted
      ? "The mirror's row was removed."
      : "The mirror's row was kept.",
  ].filter((line): line is string => Boolean(line));
}
