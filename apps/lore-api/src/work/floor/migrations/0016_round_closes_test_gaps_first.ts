// A round the test review sent back reads test-gaps.md and closes those tests before any other facet.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("loop-tdd-round", "loop-tdd-round.md");
};
