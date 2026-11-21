// A generated file, such as an API schema built from the routes, now reaches the story review as its diff alone, marked `generated`: the three story agents are told so.
import type { FloorMigration } from "../floor-migrations.js";

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  await updatePrompt("review-story", "review-story.md");
  await updatePrompt("review-implementation", "review-implementation.md");
  await updatePrompt("review-issue", "review-issue.md");
};
