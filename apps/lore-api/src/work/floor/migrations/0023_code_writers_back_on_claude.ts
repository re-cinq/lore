// One day on Gemini (0022) cost more than it saved where code is written: the first ticket took six Hydrogen rounds and over $20, against $2 to $4 on Sonnet 5.5. The three agents that write code go back to Sonnet 5.5 and the test review to Opus 5.5. The six planning and spec-writing agents, on Sonnet 4.6 before 0022, go to Sonnet 5.5 by the owner's decision. Reviews and every other agent stay on Gemini.
import { shippedModelsOf } from "../floor-migrations.js";

export const migrate = shippedModelsOf([
  "loop-tdd-round",
  "loop-test-review",
  "spec-upkeep-update-specs",
  "onboard-author",
  "plan-analyze",
  "plan-sketch",
  "plan-validate",
  "spec-analysis",
  "spec-write",
  "spec-rework",
]);
