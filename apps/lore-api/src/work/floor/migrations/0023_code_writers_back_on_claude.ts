// One day on Gemini (0022) cost more than it saved where code is written: the first ticket took six Hydrogen rounds and over $20, against $2 to $4 on Sonnet 5.5. The three agents that write code go back to Sonnet 5.5 and the test review to Opus 5.5; reviews, planning and every other agent stay on Gemini.
import type { FloorMigration } from "../floor-migrations.js";

const SWITCHED_AGENTS = [
  "loop-tdd-round",
  "loop-test-review",
  "spec-upkeep-update-specs",
  "onboard-author",
];

export const migrate: FloorMigration = async ({ updateModel }) => {
  for (const agent of SWITCHED_AGENTS) {
    await updateModel(agent, `${agent}.md`);
  }
};
