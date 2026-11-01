// The loop agents call lore_assemble_context after reading the ticket.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("loop-dod", "loop-dod.md");
  await updatePrompt("loop-tdd-round", "loop-tdd-round.md");
  await updatePrompt("loop-fix-ci", "loop-fix-ci.md");
  await updatePrompt("loop-sync", "loop-sync.md");
};
