// Moving the per-repo overrides stored in lore.agent_definitions onto the floor as variants (#3995): only the fields a repo row changed from its org row, since a repo row copied the whole definition and would otherwise pin a stale prompt.
import { isDeepStrictEqual } from "node:util";
import type { FloorAgentDefs } from "./agent-defs-floor.js";
import type { AgentDefinition } from "./agent-defs-port.js";

const MOVED_FIELDS = [
  "model",
  "timeout_minutes",
  "prompt",
  "image",
  "config",
] as const;

type MovedField = (typeof MOVED_FIELDS)[number];

/** A stored row; `repo` is null for the org default. */
export type StoredAgentRow = Pick<AgentDefinition, "name" | MovedField> & {
  repo: string | null;
};

export interface OverrideMove {
  repo: string;
  name: string;
  patch: Partial<Pick<AgentDefinition, MovedField>>;
}

export interface MoveReport {
  /** `name@repo: field, field` for each variant that changed. */
  moved: string[];
  /** `name@repo` for each agent the floor holds no definition of. */
  skipped: string[];
}

export function overrideMoves(rows: readonly StoredAgentRow[]): OverrideMove[] {
  const orgRows = new Map(
    rows.filter((row) => row.repo === null).map((row) => [row.name, row]),
  );

  return rows
    .filter(
      (row): row is StoredAgentRow & { repo: string } => row.repo !== null,
    )
    .map((row) => ({
      repo: row.repo,
      name: row.name,
      patch: changedFrom(row, orgRows.get(row.name)),
    }))
    .filter((move) => Object.keys(move.patch).length > 0);
}

function changedFrom(
  row: StoredAgentRow,
  org: StoredAgentRow | undefined,
): OverrideMove["patch"] {
  const changed = MOVED_FIELDS.filter(
    (field) =>
      row[field] !== null &&
      !isDeepStrictEqual(row[field], org?.[field] ?? null),
  );

  return Object.fromEntries(changed.map((field) => [field, row[field]]));
}

export async function moveOverridesToFloor(
  moves: readonly OverrideMove[],
  floor: FloorAgentDefs,
): Promise<MoveReport> {
  const report: MoveReport = { moved: [], skipped: [] };

  for (const move of moves) {
    await moveOne(move, floor, report);
  }

  return report;
}

async function moveOne(
  move: OverrideMove,
  floor: FloorAgentDefs,
  report: MoveReport,
): Promise<void> {
  const label = `${move.name}@${move.repo}`;
  const resolved = await floor.resolve(move.repo, move.name);

  if (!resolved) {
    report.skipped.push(label);

    return;
  }
  const fields = Object.keys(move.patch) as MovedField[];
  const pending = fields.filter(
    (field) => !isDeepStrictEqual(resolved[field], move.patch[field]),
  );

  if (pending.length === 0) {
    return;
  }
  await floor.update(move.repo, move.name, move.patch);
  report.moved.push(`${label}: ${pending.join(", ")}`);
}
