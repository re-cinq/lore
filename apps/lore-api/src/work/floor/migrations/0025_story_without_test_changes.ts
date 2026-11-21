// A change that adds and changes no test, such as one setting in a values file, got a story that told the unchanged tests as what the change does: the story now says the tests cannot show it, and tells them as what already holds.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("review-story", "review-story.md");
};
