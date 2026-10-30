// What each agent definition did on the floor lately: its stations' visits, cost and tokens, read from the floor's costs grouped by station.

import type { FloorClient } from "@re-cinq/floor-client";
import { readFloorPipelineFiles } from "../floor/seed-floor-pipelines.js";
import { stationDefinitions } from "./pipeline-agents.js";

const ACTIVITY_DAYS = 30;

type CostsRow = Awaited<ReturnType<FloorClient["costs"]["summary"]>>[number];

export interface DefinitionActivity {
  name: string;
  visits: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

/** The last 30 days on the floor, per agent definition. */
export async function readDefinitionActivity(
  floor: Pick<FloorClient, "costs">,
  now: Date,
) {
  const since = new Date(now.getTime() - ACTIVITY_DAYS * 86_400_000);
  const [rows, definitions] = await Promise.all([
    floor.costs.summary({ since: since.toISOString() }, "station"),
    readFloorPipelineFiles().then(stationDefinitions),
  ]);

  return {
    since: since.toISOString(),
    activity: activityByDefinition(rows, definitions),
  };
}

/** The floor's per-station rows summed per agent definition, sorted by name; a station no definition runs is left out. */
export function activityByDefinition(
  rows: CostsRow[],
  definitions: ReadonlyMap<string, string>,
): DefinitionActivity[] {
  const byName = new Map<string, DefinitionActivity>();

  rows.forEach((row) => {
    const name = definitions.get(row.key ?? "");

    if (name !== undefined) {
      byName.set(name, addRow(byName.get(name) ?? emptyActivity(name), row));
    }
  });

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function emptyActivity(name: string): DefinitionActivity {
  return { name, visits: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
}

function addRow(sum: DefinitionActivity, row: CostsRow): DefinitionActivity {
  return {
    name: sum.name,
    visits: sum.visits + row.visits,
    costUsd: sum.costUsd + row.costUsd,
    tokensIn: sum.tokensIn + row.tokensIn,
    tokensOut: sum.tokensOut + row.tokensOut,
  };
}
