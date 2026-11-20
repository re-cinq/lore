// Both checks reported the same difference, each in its own words, as two blocking findings: the issue check now reads what the implementation check found and reports only what that leaves out.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("review-issue", "review-issue.md");
};
