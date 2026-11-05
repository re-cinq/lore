// The loop agents read the briefing the brief station built before asking for context themselves.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("loop-dod", "loop-dod.md");
  await updatePrompt("loop-tdd-round", "loop-tdd-round.md");
  await updatePrompt("loop-fix-ci", "loop-fix-ci.md");
};
