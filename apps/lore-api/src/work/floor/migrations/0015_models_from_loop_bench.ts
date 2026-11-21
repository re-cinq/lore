// loop-bench (re-cinq/loop-bench, 3,185 runs on 5 tickets) ranked the models by how often the project's checks pass on what they deliver: Sonnet 5.5 writes code, Gemini 4 Carbon fixes a red build and Gemini 4 Hydrogen writes the tests; agents doing the same kind of work follow them.
import { shippedModelsOf } from "../floor-migrations.js";

export const migrate = shippedModelsOf([
  "loop-tdd-round",
  "spec-upkeep-update-specs",
  "onboard-author",
  "loop-fix-ci",
  "loop-sync",
  "onboard-fix-ci",
  "spec-upkeep-fix-ci",
  "loop-dod",
  "spec-qa-generate",
  "spec-qa-answer",
  "spec-qa-recheck",
  "spec-draft",
  "spec-tickets-decompose",
]);
