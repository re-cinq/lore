// Before the server listens: the floor must hold the pipelines this release ships, so a prompt or setting changed here is what the next run uses. A floor out of reach must not stop the deploy — what it already holds is still what runs.
import type { Pool } from "pg";
import type { DefinitionDrift } from "@re-cinq/lore-shared/project/agents/agent-prompts.js";
import { recordFloorAgentDrift } from "@re-cinq/lore-shared/otel/metrics.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  productionSeedDeps,
  seedFloorPipelines,
  type SeedDeps,
  type SeedFailure,
} from "./seed-floor-pipelines.js";

export interface FloorSeeding {
  configured(): boolean;
  deps(): SeedDeps;
  log(message: string, cause?: unknown): void;
}

/** The seeding lore-api runs, reading each agent's settings through `pool`. */
export function productionSeeding(pool: Pool | null): FloorSeeding {
  return {
    configured: () => floorConfigured(),
    deps: () => productionSeedDeps(pool),
    log: (message, cause) =>
      console.error(`[lore-api] ${message}`, cause ?? ""),
  };
}

export async function seedFloor(seeding: FloorSeeding): Promise<void> {
  if (!seeding.configured()) {
    return;
  }

  try {
    const { changed, failed, drift } = await seedFloorPipelines(seeding.deps());

    seeding.log(`floor pipelines put: ${changed.join(", ") || "none changed"}`);
    reportRefusals(seeding, failed);
    reportDrift(seeding, drift);
  } catch (err) {
    seeding.log(
      "floor pipeline put FAILED — the floor keeps what it holds:",
      err,
    );
  }
}

function reportRefusals(seeding: FloorSeeding, failed: SeedFailure[]): void {
  if (failed.length === 0) {
    return;
  }

  seeding.log(
    `floor REFUSED, and keeps what it holds for: ${failed.map(described).join(", ")}`,
  );
}

function described(failure: SeedFailure): string {
  return `${failure.name} (${failure.reason})`;
}

// Never silent: a drifted definition is what the next run of it is handed, and nobody saved it.
function reportDrift(seeding: FloorSeeding, drift: DefinitionDrift[]): void {
  if (drift.length === 0) {
    return;
  }
  drift.forEach((entry) => recordFloorAgentDrift(entry.name));
  seeding.log(
    `floor agent definitions DRIFTED from lore.agent_definitions after the put: ${drift
      .map((entry) => `${entry.name} (${entry.fields.join(", ")})`)
      .join("; ")}`,
  );
}
