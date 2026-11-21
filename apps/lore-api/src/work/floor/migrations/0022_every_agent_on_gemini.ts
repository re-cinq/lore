// The organisation's Anthropic credit ran out on 2026-11-20 and every Claude agent failed with "Credit balance is too low": each now runs on the Gemini 4 model of its tier, Carbon for Opus, Argon for Sonnet, and Hydrogen for the three that write code, which loop-bench ranks first among the Gemini models at that work.
import { shippedModelsOf } from "../floor-migrations.js";

export const migrate = shippedModelsOf([
  "loop-tdd-round",
  "loop-test-review",
  "spec-upkeep-update-specs",
  "onboard-author",
  "review-story",
  "review-implementation",
  "review-issue",
  "review-docs",
  "code-review-refine",
  "plan-analyze",
  "plan-sketch",
  "plan-validate",
  "spec-analysis",
  "spec-write",
  "spec-rework",
]);
