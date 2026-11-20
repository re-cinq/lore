// Review packets are written as numbered lines a reader pages through, and a file the packet lacks is a limitation, never an incomplete pass.
import type { FloorMigration } from "../floor-migrations.js";

const REVIEW_AGENTS = [
  "shadow-review-reader",
  "shadow-compare-intent",
  "shadow-review-challenge",
  "shadow-review-product",
  "code-review-product",
];

export const migrate: FloorMigration = async ({ updatePrompt }) => {
  for (const agent of REVIEW_AGENTS) {
    await updatePrompt(agent, `${agent}.md`);
  }
};
