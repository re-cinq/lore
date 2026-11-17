// The spec-tickets decompose agent writes no catch-all task and takes each task's spec_lines from its own missing or partial statements.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
};
