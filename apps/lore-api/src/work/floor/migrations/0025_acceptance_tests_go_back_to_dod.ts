// A round that names a wrong acceptance test reports test_wrong, and dod reads dod-feedback.md when the ticket comes back to it (specs/external-floor FR12.24, FR12.25).
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("loop-tdd-round", "loop-tdd-round.md");
  await updatePrompt("loop-dod", "loop-dod.md");
};
