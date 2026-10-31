// Before the server listens: every per-repo agent override still stored in lore.agent_definitions is moved onto the floor as a variant (#3995), so it applies to the repo's runs. Idempotent: a boot after the first finds every variant in place and puts nothing. A failure must not stop the deploy.
import type { Pool } from "pg";
import {
  floorClient,
  floorConfigured,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { FloorAgentDefs } from "@re-cinq/lore-shared/project/agents/agent-defs-floor.js";
import { storedAgentRows } from "@re-cinq/lore-shared/project/agents/agent-defs-pg.js";
import {
  moveOverridesToFloor,
  overrideMoves,
  type MoveReport,
} from "@re-cinq/lore-shared/project/agents/override-moves.js";

export async function moveOverridesAtBoot(pool: Pool): Promise<void> {
  if (!floorConfigured()) {
    return;
  }

  try {
    const moves = overrideMoves(await storedAgentRows(pool));
    const { agentDefinitions } = floorClient();
    const report = await moveOverridesToFloor(
      moves,
      new FloorAgentDefs(agentDefinitions),
    );

    console.error(
      `[lore-api] agent overrides moved to the floor: ${described(report)}`,
    );
  } catch (err) {
    console.error(
      "[lore-api] moving agent overrides to the floor FAILED — will try again at the next boot:",
      err,
    );
  }
}

function described(report: MoveReport): string {
  const moved = report.moved.join("; ") || "none";
  const skipped =
    report.skipped.length > 0
      ? `; no floor agent for: ${report.skipped.join(", ")}`
      : "";

  return moved + skipped;
}
