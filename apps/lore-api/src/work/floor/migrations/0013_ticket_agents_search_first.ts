// The spec-tickets and issue-triage decompose agents search open and closed tickets with lore_search_tickets before proposing one.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("spec-tickets-decompose", "spec-tickets-decompose.md");
  await updatePrompt("triage-decompose", "triage-decompose.md");
};
