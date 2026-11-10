// The spec-tickets decompose agent leaves the statements the load step settled on their linked tests to verification, and assesses only the rest.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
};
