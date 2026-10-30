import type { Pool } from "pg";
import { productionSeeding, seedFloor } from "../work/floor/seed-floor.js";

/** Boot's floor seed: after the agent definitions are seeded from the md files, the floor pipelines are put from those rows through `pool`. */
export function seedFloorAtBoot(pool: Pool | null): Promise<void> {
  return seedFloor(productionSeeding(pool));
}
