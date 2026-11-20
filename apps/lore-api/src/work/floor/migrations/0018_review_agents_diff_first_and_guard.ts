// Review packets lead with each modified file's diff, and the five pass agents carry the skill that holds their Bash guard.
import type { FloorMigration } from "../floor-migrations.js";

const REVIEW_AGENTS = [
  "shadow-review-reader",
  "shadow-compare-intent",
  "shadow-review-challenge",
  "shadow-review-product",
  "code-review-product",
];

export const migrate: FloorMigration = async ({
  updatePrompt,
  updateSkills,
}) => {
  for (const agent of REVIEW_AGENTS) {
    await updatePrompt(agent, `${agent}.md`);
    await updateSkills(agent, `${agent}.md`);
  }
};
