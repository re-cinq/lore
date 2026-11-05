// The agents that write spec links learn the content hash a link carries, and that the formatter writes it.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("loop-dod", "loop-dod.md");
  await updatePrompt("loop-tdd-round", "loop-tdd-round.md");
  await updatePrompt("spec-upkeep-update-specs", "spec-upkeep-update-specs.md");
};
