// The Anthropic credit was topped up on 2026-11-21: the four story review agents and the reply's refine agent go back to Sonnet 5.5, which the one-story review was built and tried on. The whole-diff fallback stays on Gemini 4 Argon.
import { shippedModelsOf } from "../floor-migrations.js";

export const migrate = shippedModelsOf([
  "review-story",
  "review-implementation",
  "review-issue",
  "review-docs",
  "code-review-refine",
]);
