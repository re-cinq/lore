// A check wrote "I could not open the test files" without having opened them: both checks now open the packets before they speak about them. 0017 to 0019 ran on the floor and their files are gone, so this is 0020.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("review-implementation", "review-implementation.md");
  await updatePrompt("review-issue", "review-issue.md");
};
