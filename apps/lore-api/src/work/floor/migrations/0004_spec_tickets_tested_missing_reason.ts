// The spec-tickets decompose agent reads the code behind a statement's linked test before calling it missing, and gives a reason when it still is.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
};
