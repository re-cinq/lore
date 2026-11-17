// The spec-tickets decompose agent leaves a closed ticket's task out instead of writing a placeholder the verifier rejects.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
};
