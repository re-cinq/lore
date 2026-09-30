// Before the server listens: the floor must know the lines Lore is about to start on it. A floor out of reach must not stop the deploy — a line it already has is still the one that runs.
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  productionSeedDeps,
  seedFloorPipelines,
  type SeedDeps,
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
    const seeded = await seedFloorPipelines(seeding.deps());

    seeding.log(
      `floor pipelines seeded: ${seeded.join(", ") || "none missing"}`,
    );
  } catch (err) {
    seeding.log(
      "floor pipeline seed FAILED — the floor keeps the lines it has:",
      err,
    );
  }
}
