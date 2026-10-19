// Before the server listens: the floor must hold the pipelines this release ships, so a prompt or setting changed here is what the next run uses. A floor out of reach must not stop the deploy — what it already holds is still what runs.
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  productionSeedDeps,
  seedFloorPipelines,
  type SeedDeps,
  type SeedFailure,
} from "../work/floor/seed-floor-pipelines.js";

export interface FloorSeeding {
  configured(): boolean;
  deps(): SeedDeps;
  log(message: string, cause?: unknown): void;
}

const production: FloorSeeding = {
  configured: () => floorConfigured(),
  deps: () => productionSeedDeps(),
  log: (message, cause) => console.error(`[lore-api] ${message}`, cause ?? ""),
};

export async function seedFloor(
  seeding: FloorSeeding = production,
): Promise<void> {
  if (!seeding.configured()) {
    return;
  }

  try {
    const { changed, failed } = await seedFloorPipelines(seeding.deps());

    seeding.log(`floor pipelines put: ${changed.join(", ") || "none changed"}`);
    reportRefusals(seeding, failed);
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
