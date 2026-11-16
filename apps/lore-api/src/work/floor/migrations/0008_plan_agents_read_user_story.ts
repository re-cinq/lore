// The planning agents read the plan's user story from lore_plan_read beside its sections.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("plan-analyze", "plan-analyze.md");
  await updatePrompt("plan-validate", "plan-validate.md");
};
